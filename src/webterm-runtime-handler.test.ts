import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebtermRuntimeHandler, shellSingleQuote, decodeSlackEntities } from "./webterm-runtime-handler";

// Mock webterm: records HTTP calls and lets the test drive SSE events
// through a writable readable-stream pump.

function makeMockWebterm() {
  let nextSessionId = 1;
  const sessions = new Map<string, {
    sseController: ReadableStreamDefaultController<Uint8Array> | null;
    inputs: { kind: string; data?: string; keys?: string[] }[];
    text: string;
    title?: string;
    alive?: boolean;
  }>();
  const calls: { method: string; url: string; body?: any }[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    calls.push({ method, url, body });

    if (method === "POST" && url.endsWith("/api/sessions")) {
      const id = `sess-${nextSessionId++}`;
      sessions.set(id, { sseController: null, inputs: [], text: "", title: body?.title, alive: true });
      return new Response(JSON.stringify({ id }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (method === "GET" && url.endsWith("/api/sessions")) {
      const list = Array.from(sessions.entries()).map(([id, s]) => ({
        id,
        title: s.title ?? "",
        alive: s.alive !== false,
        cols: 120,
        rows: 40,
      }));
      return new Response(JSON.stringify(list), { status: 200, headers: { "content-type": "application/json" } });
    }
    const mEvents = url.match(/\/api\/sessions\/([^\/?]+)\/events/);
    if (method === "GET" && mEvents) {
      const id = mEvents[1];
      const s = sessions.get(id);
      if (!s) return new Response("not found", { status: 404 });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { s.sseController = controller; },
        cancel() { s.sseController = null; },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    const mInput = url.match(/\/api\/sessions\/([^\/?]+)\/input/);
    if (method === "POST" && mInput) {
      const id = mInput[1];
      const s = sessions.get(id);
      if (!s) return new Response("not found", { status: 404 });
      s.inputs.push(body);
      return new Response(null, { status: 204 });
    }
    const mText = url.match(/\/api\/sessions\/([^\/?]+)\/text/);
    if (method === "GET" && mText) {
      const id = mText[1];
      const s = sessions.get(id);
      if (!s) return new Response("not found", { status: 404 });
      return new Response(s.text, { status: 200 });
    }
    const mDelete = url.match(/\/api\/sessions\/([^\/?]+)$/);
    if (method === "DELETE" && mDelete) {
      const id = mDelete[1];
      const s = sessions.get(id);
      if (s?.sseController) s.sseController.close();
      sessions.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  };

  return {
    fetchImpl,
    sessions,
    calls,
    emitPromptReady(sessionId: string) {
      const s = sessions.get(sessionId);
      if (!s?.sseController) throw new Error(`no SSE controller for ${sessionId}`);
      const payload = `event: prompt-ready\ndata: {"stableForMs":800,"polls":3}\n\n`;
      s.sseController.enqueue(new TextEncoder().encode(payload));
    },
    emitExit(sessionId: string, code: number) {
      const s = sessions.get(sessionId);
      if (!s?.sseController) throw new Error(`no SSE controller for ${sessionId}`);
      const payload = `event: exit\ndata: {"code":${code}}\n\n`;
      s.sseController.enqueue(new TextEncoder().encode(payload));
      s.sseController.close();
    },
    setText(sessionId: string, text: string) {
      const s = sessions.get(sessionId);
      if (!s) throw new Error(`no session ${sessionId}`);
      s.text = text;
    },
    seedSession(id: string, title: string, text: string) {
      sessions.set(id, { sseController: null, inputs: [], text, title, alive: true });
    },
    onlySessionId() {
      const ids = Array.from(sessions.keys());
      if (ids.length !== 1) throw new Error(`expected 1 session, got ${ids.length}`);
      return ids[0];
    },
  };
}

function makeSlack() {
  const posted: { channel: string; thread_ts?: string; text: string }[] = [];
  return {
    posted,
    client: {
      chat: {
        postMessage: vi.fn(async (msg: any) => { posted.push(msg); return { ok: true } as any; }),
      },
    } as any,
  };
}

function buildBootGrid(): string {
  // Boot screen: prompt is visible, no user input echoed yet, no ⏺ block.
  return [
    "claude --dangerously-skip-permissions",
    "[webterm:test] user@host claudeclaw % claude --dangerously-skip-permissions",
    " ▐▛███▜▌   Claude Code v2.1.156",
    "",
    "────────────────────────────────────────",
    "❯",
    "────────────────────────────────────────",
    "   Opus 4.8 (1M context) │ ⏱ 0s",
  ].join("\n");
}

function buildTurnGrid(userInput: string, assistant: string): string {
  return [
    "claude --dangerously-skip-permissions",
    "[webterm:test] user@host claudeclaw %",
    "",
    `❯ ${userInput}`,
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

describe("WebtermRuntimeHandler", () => {
  let mock: ReturnType<typeof makeMockWebterm>;
  let slack: ReturnType<typeof makeSlack>;
  let handler: WebtermRuntimeHandler;

  beforeEach(() => {
    mock = makeMockWebterm();
    slack = makeSlack();
    handler = new WebtermRuntimeHandler({
      webtermUrl: "http://test.local",
      fetchImpl: mock.fetchImpl,
      cwd: "/tmp/test",
      pasteSettleMs: 5,
      extractStableMs: 10,
    });
  });

  it("creates a session, boots claude, and waits for first prompt-ready before returning", async () => {
    const req = {
      channelId: "C1",
      threadTs: "1234.5",
      text: "what is 2+2?",
      slack: slack.client,
    };
    // Drive: arrange SSE to fire prompt-ready as soon as the listener subscribes.
    // We can't predict the session id before the POST happens, so we kick the
    // handler off and then race the SSE emissions in.
    const handlePromise = handler.handleMessage(req);

    // Yield until the session is created and SSE is subscribed.
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    // Boot complete: fire prompt-ready
    mock.emitPromptReady(id);
    // Wait until the boot completed (inputs[0] should be the claude command).
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 2);
    // After boot, the handler sends the user's input (text + Enter) — inputs[2]+[3]
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    // Set the grid text for the response and fire prompt-ready
    mock.setText(id, buildTurnGrid(req.text, "2 plus 2 equals 4."));
    mock.emitPromptReady(id);

    await handlePromise;
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].channel).toBe("C1");
    expect(slack.posted[0].thread_ts).toBe("1234.5");
    expect(slack.posted[0].text).toContain("2 plus 2 equals 4.");
  });

  it("reuses a session for the same channel + thread on a second message", async () => {
    const req1 = { channelId: "C1", threadTs: "T1", text: "first", slack: slack.client };
    const req2 = { channelId: "C1", threadTs: "T1", text: "second", slack: slack.client };

    // First turn — boot + reply
    const p1 = handler.handleMessage(req1);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);  // boot done
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);  // claude\n + user\n
    mock.setText(id, buildTurnGrid("first", "ok one"));
    mock.emitPromptReady(id);
    await p1;

    // Second turn — same session, no new POST /api/sessions
    const callsBefore = mock.calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/sessions")).length;
    const p2 = handler.handleMessage(req2);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 6);  // user2\n
    mock.setText(id, buildTurnGrid("second", "ok two"));
    mock.emitPromptReady(id);
    await p2;
    const callsAfter = mock.calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/sessions")).length;

    expect(callsAfter).toBe(callsBefore);  // no new session POST
    expect(slack.posted).toHaveLength(2);
    expect(slack.posted[1].text).toContain("ok two");
  });

  it("creates separate sessions for different threads in the same channel", async () => {
    const reqA = { channelId: "C1", threadTs: "TA", text: "hi from A", slack: slack.client };
    const reqB = { channelId: "C1", threadTs: "TB", text: "hi from B", slack: slack.client };

    const pA = handler.handleMessage(reqA);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const idA = mock.onlySessionId();
    mock.emitPromptReady(idA);
    await waitFor(() => mock.sessions.get(idA)!.inputs.length >= 4);
    mock.setText(idA, buildTurnGrid("hi from A", "A says hi"));
    mock.emitPromptReady(idA);
    await pA;

    const pB = handler.handleMessage(reqB);
    await waitFor(() => mock.sessions.size === 2);
    const idB = [...mock.sessions.keys()].find((k) => k !== idA)!;
    await waitFor(() => mock.sessions.get(idB)!.sseController !== null);
    mock.emitPromptReady(idB);
    await waitFor(() => mock.sessions.get(idB)!.inputs.length >= 4);
    mock.setText(idB, buildTurnGrid("hi from B", "B says hi"));
    mock.emitPromptReady(idB);
    await pB;

    expect(handler._sessionCount()).toBe(2);
    expect(slack.posted[0].text).toContain("A says hi");
    expect(slack.posted[1].text).toContain("B says hi");
  });

  it("deduplicates concurrent first-message creations for the same thread", async () => {
    const reqA = { channelId: "C1", threadTs: "T1", text: "first", slack: slack.client };
    const reqB = { channelId: "C1", threadTs: "T1", text: "second", slack: slack.client };

    // Fire both before the first session is created — they should share creation.
    const pA = handler.handleMessage(reqA);
    const pB = handler.handleMessage(reqB);

    // Wait until ONE session exists with SSE bound.
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);  // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);  // claude\n + first\n
    mock.setText(id, buildTurnGrid("first", "ok one"));
    mock.emitPromptReady(id);

    // Second turn (the deferred B) shares the session.
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 6);
    mock.setText(id, buildTurnGrid("second", "ok two"));
    mock.emitPromptReady(id);

    await Promise.all([pA, pB]);
    // Critical: only ONE session, even though two messages arrived concurrently.
    expect(mock.sessions.size).toBe(1);
    expect(slack.posted).toHaveLength(2);
  });

  it("retries when extraction is empty on a premature prompt-ready (claw-etj7)", async () => {
    const req = { channelId: "C1", threadTs: "T1", text: "what gives?", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);  // boot

    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // First prompt-ready: claude hasn't responded yet — grid has the user echo
    // (so extractor returns non-null) but no ⏺ block (so assistant is "").
    // The handler must treat this as retryable, same as the null case.
    mock.setText(id, [
      "❯ what gives?",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
    ].join("\n"));
    mock.emitPromptReady(id);
    await sleep(20);
    expect(slack.posted).toHaveLength(0);

    // Second prompt-ready: claude has now responded. Extractor returns content.
    mock.setText(id, buildTurnGrid("what gives?", "Eventually, the answer is 4."));
    mock.emitPromptReady(id);
    await p;
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].text).toContain("the answer is 4");
  });

  it("posts a warning to Slack when session creation fails", async () => {
    const flaky: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST" && url.endsWith("/api/sessions")) {
        return new Response("server gone", { status: 500 });
      }
      return mock.fetchImpl(input as any, init);
    };
    handler = new WebtermRuntimeHandler({
      webtermUrl: "http://test.local",
      fetchImpl: flaky,
      cwd: "/tmp/test",
    });
    const req = { channelId: "C1", threadTs: "T1", text: "hello", slack: slack.client };
    await handler.handleMessage(req);
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].text).toMatch(/webterm session creation failed/);
  });

  it("sends turn text as bracketed paste and delays Enter past the paste-settle window", async () => {
    // claude's TUI swallows an Enter that arrives immediately after a bracketed
    // paste (aggregated into the paste burst as a newline) — verified empirically
    // 2026-06-11 on v2.1.173. The handler must wait out the settle window.
    handler = new WebtermRuntimeHandler({
      webtermUrl: "http://test.local",
      fetchImpl: mock.fetchImpl,
      cwd: "/tmp/test",
      pasteSettleMs: 250,
    });
    const text = "line one\nline two\n```\nconst x = 1;\n```";
    const p = handler.handleMessage({ channelId: "C1", threadTs: "T1", text, slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot done

    // The turn text arrives as inputs[2] (after boot cmd + its Enter).
    await waitFor(() => mock.sessions.get(id)!.inputs.length === 3);
    const inputs = mock.sessions.get(id)!.inputs;
    expect(inputs[0].kind).toBe("text"); // boot command path unchanged
    expect(inputs[2]).toEqual({ kind: "paste", data: text });

    // Enter must NOT follow within the settle window.
    await sleep(60);
    expect(mock.sessions.get(id)!.inputs.length).toBe(3);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    expect(mock.sessions.get(id)!.inputs[3]).toEqual({ kind: "keys", keys: ["Enter"] });

    mock.setText(id, buildTurnGrid("line one", "got the snippet"));
    mock.emitPromptReady(id);
    await p;
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].text).toContain("got the snippet");
  });

  it("boots claude with --append-system-prompt carrying channel + thread context", async () => {
    const p = handler.handleMessage({
      channelId: "C0AKRDL2Y9F",
      threadTs: "1717.42",
      text: "hello",
      slack: slack.client,
    });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.setText(id, buildTurnGrid("hello", "hi"));
    mock.emitPromptReady(id);
    await p;

    const boot = mock.sessions.get(id)!.inputs[0];
    expect(boot.kind).toBe("text");
    expect(boot.data).toContain(
      "--append-system-prompt 'You are responding in Slack channel ID: C0AKRDL2Y9F (thread: 1717.42).",
    );
    expect(boot.data).toContain("channel-specific protocols");
    expect(boot.data).toContain("Format responses for Slack");
  });

  it("omits the thread clause when there is no threadTs", async () => {
    const p = handler.handleMessage({
      channelId: "D777",
      threadTs: undefined,
      text: "yo",
      slack: slack.client,
    });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.setText(id, buildTurnGrid("yo", "hey"));
    mock.emitPromptReady(id);
    await p;

    const boot = mock.sessions.get(id)!.inputs[0];
    expect(boot.data).toContain("Slack channel ID: D777.");
    expect(boot.data).not.toContain("(thread:");
  });

  it("waits for the render to settle before posting — partial ⏺ at prompt-ready (fable thinking pauses)", async () => {
    // Observed live 2026-06-11: fable at max effort pauses >1.2s mid-render,
    // prompt-ready fires, and a 3-part answer posted with only part 1. The
    // handler must confirm the extraction is stable before posting.
    const req = { channelId: "C1", threadTs: "T1", text: "three parts please", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // Prompt-ready fires while only part one is rendered…
    mock.setText(id, buildTurnGrid("three parts please", "part one."));
    mock.emitPromptReady(id);
    // …and the rest of the response lands during the stability window.
    await sleep(5);
    mock.setText(id, buildTurnGrid("three parts please", "part one. part two. part three."));

    await p;
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].text).toContain("part three");
  });

  it("decodes Slack mrkdwn HTML entities before sending to the PTY", async () => {
    // Slack escapes & < > in message text; pasting them raw corrupts code
    // (observed live: `=>` arrived in claude's input as `=&gt;`).
    const raw = "is a &lt; b &amp;&amp; b &gt; c? also: x =&gt; y";
    const decoded = "is a < b && b > c? also: x => y";
    const p = handler.handleMessage({ channelId: "C1", threadTs: "T1", text: raw, slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    expect(mock.sessions.get(id)!.inputs[2]).toEqual({ kind: "paste", data: decoded });
    mock.setText(id, buildTurnGrid(decoded, "yes on both"));
    mock.emitPromptReady(id);
    await p;
    expect(slack.posted[0].text).toContain("yes on both");
  });

  it("shutdown() leaves webterm sessions alive for adoption after restart (claw-usdo)", async () => {
    const req = { channelId: "C1", threadTs: "T1", text: "hi", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);  // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.setText(id, buildTurnGrid("hi", "hello back"));
    mock.emitPromptReady(id);
    await p;

    expect(handler._sessionCount()).toBe(1);
    await handler.shutdown();
    expect(handler._sessionCount()).toBe(0);
    // The webterm session must survive — it carries the conversation.
    expect(mock.calls.find((c) => c.method === "DELETE" && c.url.includes(id))).toBeUndefined();
  });

  it("shutdown({ killSessions: true }) tears sessions down explicitly", async () => {
    const req = { channelId: "C1", threadTs: "T1", text: "hi", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.setText(id, buildTurnGrid("hi", "hello back"));
    mock.emitPromptReady(id);
    await p;

    await handler.shutdown({ killSessions: true });
    expect(mock.calls.find((c) => c.method === "DELETE" && c.url.includes(id))).toBeTruthy();
  });

  it("adopts a surviving webterm session for the thread instead of creating a new one", async () => {
    // A previous bot process created this session; its title carries the
    // threadKey and claude is still running inside (model status row present).
    mock.seedSession("sess-old", "slack-bot C1::T1", buildBootGrid());

    const req = { channelId: "C1", threadTs: "T1", text: "are you still there?", slack: slack.client };
    const p = handler.handleMessage(req);

    // No boot: the turn paste goes straight in as inputs[0].
    await waitFor(() => mock.sessions.get("sess-old")!.inputs.length >= 2);
    expect(mock.sessions.get("sess-old")!.inputs[0]).toEqual({ kind: "paste", data: "are you still there?" });
    mock.setText("sess-old", buildTurnGrid("are you still there?", "still here, context intact"));
    mock.emitPromptReady("sess-old");
    await p;

    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].text).toContain("still here");
    // Critical: no new session was created.
    expect(mock.calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/sessions"))).toHaveLength(0);
    expect(handler._sessionCount()).toBe(1);
  });

  it("kills and recreates when the surviving session no longer runs claude (bare shell)", async () => {
    // claude exited inside the PTY — pasting a user message into a bare zsh
    // would execute it as a shell command. The handler must detect (no model
    // status row) and recreate instead.
    mock.seedSession("sess-dead-claude", "slack-bot C1::T1", [
      "[webterm:test] user@host claudeclaw % claude --dangerously-skip-permissions",
      "[webterm:test] user@host claudeclaw %",
    ].join("\n"));

    const req = { channelId: "C1", threadTs: "T1", text: "hello?", slack: slack.client };
    const p = handler.handleMessage(req);

    // A NEW session gets created and booted.
    await waitFor(() => mock.calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/sessions")).length === 1);
    await waitFor(() => {
      const fresh = [...mock.sessions.keys()].find((k) => k !== "sess-dead-claude");
      return !!fresh && mock.sessions.get(fresh)!.sseController !== null;
    });
    const freshId = [...mock.sessions.keys()].find((k) => k !== "sess-dead-claude")!;
    mock.emitPromptReady(freshId); // boot
    await waitFor(() => mock.sessions.get(freshId)!.inputs.length >= 4);
    mock.setText(freshId, buildTurnGrid("hello?", "fresh session here"));
    mock.emitPromptReady(freshId);
    await p;

    expect(slack.posted[0].text).toContain("fresh session here");
    // The dead-claude session was cleaned up.
    expect(mock.calls.find((c) => c.method === "DELETE" && c.url.includes("sess-dead-claude"))).toBeTruthy();
  });
});

describe("decodeSlackEntities", () => {
  it("decodes the three entities Slack escapes in message text", () => {
    expect(decodeSlackEntities("a &lt; b &gt; c &amp; d")).toBe("a < b > c & d");
  });
  it("decodes &amp; last so double-encoded sequences stay literal", () => {
    expect(decodeSlackEntities("&amp;lt;")).toBe("&lt;");
  });
  it("passes through text without entities", () => {
    expect(decodeSlackEntities("plain text")).toBe("plain text");
  });
});

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error("waitFor timed out");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
