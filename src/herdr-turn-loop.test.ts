import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HerdrClient } from "./herdr/client";
import {
  DEFAULT_IDLE_OUTPUT_FLOOR_MS,
  PaneRelay,
  RevisionClock,
  abortTurn,
  bootAgent,
  isRelayIdle,
  isWedged,
  readPane,
  sendKeys,
} from "./herdr-turn-loop";

// A real unix-domain-socket server standing in for herdr (mirrors
// src/herdr/client.test.ts's MockHerdrServer): one request per connection,
// except events.subscribe, whose socket is kept open for pushes.
class MockHerdrServer {
  readonly socketPath: string;
  private server: Server | null = null;
  private readonly openSockets = new Set<Socket>();
  private readonly subscriberSockets: Socket[] = [];
  onRequest: (id: string, method: string, params: unknown, socket: Socket) => void = () => {};

  constructor() {
    this.socketPath = join(tmpdir(), `herdr-turn-loop-test-${randomBytes(6).toString("hex")}.sock`);
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((socket) => {
        this.openSockets.add(socket);
        socket.on("close", () => this.openSockets.delete(socket));
        socket.setEncoding("utf8");
        let buffer = "";
        socket.on("data", (chunk: string) => {
          buffer += chunk;
          const idx = buffer.indexOf("\n");
          if (idx === -1) return;
          const line = buffer.slice(0, idx);
          const msg = JSON.parse(line);
          if (msg.method === "events.subscribe") this.subscriberSockets.push(socket);
          this.onRequest(msg.id, msg.method, msg.params, socket);
        });
      });
      this.server.listen(this.socketPath, resolve);
    });
  }

  push(msg: Record<string, unknown>): void {
    for (const socket of this.subscriberSockets) socket.write(`${JSON.stringify(msg)}\n`);
  }

  reply(socket: Socket, id: string, result: unknown): void {
    socket.write(`${JSON.stringify({ id, result })}\n`);
  }

  replyError(socket: Socket, id: string, code: string, message: string): void {
    socket.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
  }

  stop(): Promise<void> {
    for (const socket of this.openSockets) socket.destroy();
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
}

let mockServer: MockHerdrServer;

beforeEach(async () => {
  mockServer = new MockHerdrServer();
  await mockServer.start();
});

afterEach(async () => {
  await mockServer.stop();
  if (existsSync(mockServer.socketPath)) rmSync(mockServer.socketPath, { force: true });
});

// Same fixture shape as webterm-runtime-handler.test.ts's buildTurnGrid: a
// finished-looking answer with the completion footer and an idle prompt.
function buildTurnGrid(assistant: string): string {
  return [
    "claude --permission-mode auto",
    "",
    "❯ hello",
    "",
    `⏺ ${assistant}`,
    "",
    "✻ Cooked for 1s",
    "",
    "────────────────────────────────────────",
    "❯",
    "────────────────────────────────────────",
    "   Opus 4.8 (1M context) │ ⏱ 5s",
  ].join("\n");
}

describe("bootAgent (BOOT, trk-s5d.3)", () => {
  it("calls agent.start with the pane and kind, resolving once herdr reports the agent ready", async () => {
    mockServer.onRequest = (id, method, params, socket) => {
      expect(method).toBe("agent.start");
      expect(params).toEqual({ name: "slack-bot", kind: "claude", pane_id: "pane-1", args: [], timeout_ms: null });
      mockServer.reply(socket, id, {
        type: "agent_started",
        argv: ["claude"],
        agent: { pane_id: "pane-1", agent_status: "idle", focused: true, revision: 1, tab_id: "t1", terminal_id: "term1", workspace_id: "w1" },
      });
    };
    const client = new HerdrClient({ socketPath: mockServer.socketPath });
    const res = await bootAgent(client, { name: "slack-bot", paneId: "pane-1" });
    expect(res.agent.pane_id).toBe("pane-1");
  });

  it("surfaces agent_not_ready as a descriptive boot failure instead of a bare HerdrError", async () => {
    mockServer.onRequest = (id, _method, _params, socket) => {
      mockServer.replyError(socket, id, "agent_not_ready", "claude is blocked on the trust-folder prompt");
    };
    const client = new HerdrClient({ socketPath: mockServer.socketPath });
    await expect(bootAgent(client, { name: "slack-bot", paneId: "pane-1" })).rejects.toThrow(
      /agent boot failed \(agent_not_ready\): claude is blocked on the trust-folder prompt/,
    );
  });
});

describe("readPane (READS gotcha, trk-s5d.3)", () => {
  it("never sends `lines` — always reads the full pane, not a bounded row count", async () => {
    mockServer.onRequest = (id, method, params, socket) => {
      expect(method).toBe("pane.read");
      expect(params).toEqual({ pane_id: "pane-1", source: "visible" });
      expect((params as Record<string, unknown>).lines).toBeUndefined();
      mockServer.reply(socket, id, { type: "pane_read", read: { text: "hi", revision: 3, format: "text", pane_id: "pane-1", source: "visible", tab_id: "t1", truncated: false, workspace_id: "w1" } });
    };
    const client = new HerdrClient({ socketPath: mockServer.socketPath });
    const result = await readPane(client, "pane-1");
    expect(result).toEqual({ text: "hi", revision: 3 });
  });
});

describe("abortTurn / sendKeys (ABORT, trk-s5d.3)", () => {
  it("sends esc by default", async () => {
    mockServer.onRequest = (id, method, params, socket) => {
      expect(method).toBe("pane.send_keys");
      expect(params).toEqual({ pane_id: "pane-1", keys: ["esc"] });
      mockServer.reply(socket, id, { type: "ok" });
    };
    const client = new HerdrClient({ socketPath: mockServer.socketPath });
    await abortTurn(client, "pane-1");
  });

  it("sends ctrl+c when asked", async () => {
    mockServer.onRequest = (id, method, params, socket) => {
      expect(params).toEqual({ pane_id: "pane-1", keys: ["ctrl+c"] });
      mockServer.reply(socket, id, { type: "ok" });
    };
    const client = new HerdrClient({ socketPath: mockServer.socketPath });
    await abortTurn(client, "pane-1", "ctrl+c");
  });

  it("never calls an agent.* method for turn control (herdr-mirror precedent: no `agent` state calls)", async () => {
    const methodsCalled: string[] = [];
    mockServer.onRequest = (id, method, _params, socket) => {
      methodsCalled.push(method);
      mockServer.reply(socket, id, { type: "ok" });
    };
    const client = new HerdrClient({ socketPath: mockServer.socketPath });
    await sendKeys(client, "pane-1", ["esc"]);
    expect(methodsCalled).toEqual(["pane.send_keys"]);
    expect(methodsCalled.some((m) => m.startsWith("agent."))).toBe(false);
  });
});

describe("idle floor workaround (claw-3btg.4 reproduction, trk-s5d.3)", () => {
  it("does NOT read a frame as idle immediately after a revision bump, even though isGridIdle alone would", async () => {
    const clock = new RevisionClock();
    const grid = buildTurnGrid("half-rendered answer");
    // t=0: revision just bumped to 5 (fresh paint) — the exact claw-3btg.4
    // symptom: claude has already dropped its spinner and the grid LOOKS
    // idle (isGridIdle(grid) is true), but the output is only just landing.
    const idleAtBump = isRelayIdle(grid, 5, clock, { idleOutputFloorMs: 250 }, 0);
    expect(idleAtBump).toBe(false);
  });

  it("reads the same frame as idle once the floor has elapsed with no further bump", async () => {
    const clock = new RevisionClock();
    const grid = buildTurnGrid("half-rendered answer");
    expect(isRelayIdle(grid, 5, clock, { idleOutputFloorMs: 250 }, 0)).toBe(false);
    // t=300ms, same revision (5) — no new output landed, the floor has passed.
    expect(isRelayIdle(grid, 5, clock, { idleOutputFloorMs: 250 }, 300)).toBe(true);
  });

  it("resets the floor on every subsequent revision bump", async () => {
    const clock = new RevisionClock();
    const grid = buildTurnGrid("still going");
    expect(isRelayIdle(grid, 5, clock, { idleOutputFloorMs: 250 }, 0)).toBe(false);
    expect(isRelayIdle(grid, 5, clock, { idleOutputFloorMs: 250 }, 300)).toBe(true);
    // A new chunk of output lands — revision bumps to 6 — floor restarts even
    // though the grid still isGridIdle()-passes (claude re-armed its spinner
    // briefly then dropped it again, e.g. streaming a second paragraph).
    expect(isRelayIdle(grid, 6, clock, { idleOutputFloorMs: 250 }, 320)).toBe(false);
    expect(isRelayIdle(grid, 6, clock, { idleOutputFloorMs: 250 }, 620)).toBe(true);
  });

  it("uses DEFAULT_IDLE_OUTPUT_FLOOR_MS when no floor is configured", () => {
    const clock = new RevisionClock();
    const grid = buildTurnGrid("answer");
    expect(isRelayIdle(grid, 1, clock, {}, 0)).toBe(false);
    expect(isRelayIdle(grid, 1, clock, {}, DEFAULT_IDLE_OUTPUT_FLOOR_MS)).toBe(true);
  });
});

describe("isWedged (sliding-inactivity guard ported unchanged, trk-s5d.3)", () => {
  it("is not wedged before the sliding-inactivity window elapses", () => {
    expect(isWedged(0, { slidingInactivityMs: 1000 }, 999)).toBe(false);
  });

  it("is wedged once the window elapses with no change", () => {
    expect(isWedged(0, { slidingInactivityMs: 1000 }, 1001)).toBe(true);
  });
});

describe("PaneRelay (RELAY wake, trk-s5d.3 — push-based per trk-s5d.1 finding)", () => {
  it("subscribes to pane.updated and resolves 'pushed' on a matching push", async () => {
    mockServer.onRequest = (id, method, params, socket) => {
      expect(method).toBe("events.subscribe");
      expect(params).toEqual({ subscriptions: [{ type: "pane.updated" }] });
      mockServer.reply(socket, id, { type: "subscription_started" });
    };
    const relay = new PaneRelay({ socketPath: mockServer.socketPath });
    const waiter = relay.waitForChange("pane-1", 2000);
    // Give the subscribe round-trip a tick before pushing.
    await new Promise((r) => setTimeout(r, 50));
    mockServer.push({
      event: "pane_updated",
      data: { type: "pane_updated", pane: { pane_id: "pane-1", agent_status: "working", focused: true, revision: 2, tab_id: "t1", terminal_id: "term1", workspace_id: "w1" } },
    });
    await expect(waiter).resolves.toBe("pushed");
    relay.close();
  });

  it("filters out pushes for other panes and falls back to the poll timeout", async () => {
    mockServer.onRequest = (id, _method, _params, socket) => {
      mockServer.reply(socket, id, { type: "subscription_started" });
    };
    const relay = new PaneRelay({ socketPath: mockServer.socketPath });
    const waiter = relay.waitForChange("pane-1", 150);
    await new Promise((r) => setTimeout(r, 30));
    mockServer.push({
      event: "pane_updated",
      data: { type: "pane_updated", pane: { pane_id: "pane-OTHER", agent_status: "working", focused: true, revision: 2, tab_id: "t1", terminal_id: "term1", workspace_id: "w1" } },
    });
    await expect(waiter).resolves.toBe("timeout");
    relay.close();
  });
});
