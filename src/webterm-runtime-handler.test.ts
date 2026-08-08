import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebtermRuntimeHandler, shellSingleQuote, decodeSlackEntities } from "./webterm-runtime-handler";
import { ThreadSessionStore } from "./thread-session-store";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

let tssN = 0;
function freshStorePath() {
  return joinPath(mkdtempSync(joinPath(tmpdir(), "wrt-tss-")), `map-${tssN++}.json`);
}

// Mock webterm: records HTTP calls and lets the test drive SSE events
// through a writable readable-stream pump.

function makeMockWebterm() {
  let nextSessionId = 1;
  const sessions = new Map<string, {
    sseController: ReadableStreamDefaultController<Uint8Array> | null;
    inputs: { kind: string; data?: string; keys?: string[] }[];
    text: string;
    // Lines ABOVE the viewport (what GET /scrollback returns). The real
    // webterm returns rows that scrolled off the top; concatenating
    // scrollback + "\n" + text reconstructs the full transcript.
    scrollback: string;
    title?: string;
    alive?: boolean;
    lastActivityAt?: number;
    seq: number;
    lastOutputMs: number;
    exitCode?: number | null;
  }>();
  const calls: { method: string; url: string; body?: any }[] = [];
  const flags = { waitSupported: true };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    calls.push({ method, url, body });

    if (method === "POST" && url.endsWith("/api/sessions")) {
      const id = `sess-${nextSessionId++}`;
      sessions.set(id, { sseController: null, inputs: [], text: "", scrollback: "", title: body?.title, alive: true, seq: 0, lastOutputMs: 10_000 });
      return new Response(JSON.stringify({ id }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (method === "GET" && url.endsWith("/api/sessions")) {
      const list = Array.from(sessions.entries()).map(([id, s]) => ({
        id,
        title: s.title ?? "",
        alive: s.alive !== false,
        lastActivityAt: s.lastActivityAt ?? Date.now(),
        cols: 120,
        rows: 40,
        seq: s.seq,
        lastOutputMsAgo: s.lastOutputMs,
        ...(s.exitCode !== undefined ? { exitCode: s.exitCode } : {}),
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
      if (s.alive === false) {
        return new Response(JSON.stringify({ error: "session exited", exitCode: s.exitCode ?? null }), {
          status: 409, headers: { "content-type": "application/json" },
        });
      }
      s.inputs.push(body);
      const preSeq = s.seq;
      s.seq++; // the echo
      return new Response(JSON.stringify({ echoed: true, preSeq, postSeq: s.seq }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    const mScrollback = url.match(/\/api\/sessions\/([^\/?]+)\/scrollback/);
    if (method === "GET" && mScrollback) {
      const id = mScrollback[1];
      const s = sessions.get(id);
      if (!s) return new Response("not found", { status: 404 });
      const u = new URL(url);
      const from = Number(u.searchParams.get("from") ?? -200);
      const to = Number(u.searchParams.get("to") ?? 0);
      const lines = s.scrollback === "" ? [] : s.scrollback.split("\n");
      return new Response(JSON.stringify({ from, to, lines }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const mWait = url.match(/\/api\/sessions\/([^\/?]+)\/wait/);
    if (method === "GET" && mWait) {
      if (!flags.waitSupported) return new Response("not found", { status: 404 });
      const id = mWait[1];
      const s = sessions.get(id);
      if (!s) return new Response("not found", { status: 404 });
      const u = new URL(url);
      const since = Number(u.searchParams.get("since") ?? 0);
      const timeoutMs = Number(u.searchParams.get("timeoutMs") ?? 10_000);
      const deadline = Date.now() + timeoutMs;
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      while (s.seq <= since && s.alive !== false && Date.now() < deadline && !signal?.aborted) {
        await new Promise((r) => setTimeout(r, 10));
      }
      return new Response(
        JSON.stringify({ seq: s.seq, changed: s.seq > since, alive: s.alive !== false }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const mText = url.match(/\/api\/sessions\/([^\/?]+)\/text/);
    if (method === "GET" && mText) {
      const id = mText[1];
      const s = sessions.get(id);
      if (!s) return new Response("not found", { status: 404 });
      return new Response(s.text, {
        status: 200,
        headers: { "x-webterm-seq": String(s.seq), "x-webterm-last-output-ms": String(s.lastOutputMs) },
      });
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
    flags,
    emitOutputChunk(sessionId: string, data = "x") {
      const s = sessions.get(sessionId);
      if (!s?.sseController) throw new Error(`no SSE controller for ${sessionId}`);
      const payload = `event: output-chunk\ndata: ${JSON.stringify({ data })}\n\n`;
      s.sseController.enqueue(new TextEncoder().encode(payload));
    },
    emitExit(sessionId: string, code: number) {
      const s = sessions.get(sessionId);
      if (!s?.sseController) throw new Error(`no SSE controller for ${sessionId}`);
      s.alive = false;
      s.exitCode = code;
      const payload = `event: exit\ndata: {"code":${code}}\n\n`;
      s.sseController.enqueue(new TextEncoder().encode(payload));
      s.sseController.close();
    },
    setText(sessionId: string, text: string) {
      const s = sessions.get(sessionId);
      if (!s) throw new Error(`no session ${sessionId}`);
      s.text = text;
      s.seq++;
    },
    setLastOutputMs(sessionId: string, ms: number) {
      const s = sessions.get(sessionId);
      if (!s) throw new Error(`no session ${sessionId}`);
      s.lastOutputMs = ms;
    },
    setScrollback(sessionId: string, scrollback: string) {
      const s = sessions.get(sessionId);
      if (!s) throw new Error(`no session ${sessionId}`);
      s.scrollback = scrollback;
    },
    seedSession(id: string, title: string, text: string, lastActivityAt?: number) {
      sessions.set(id, { sseController: null, inputs: [], text, scrollback: "", title, alive: true, lastActivityAt, seq: 0, lastOutputMs: 10_000 });
    },
    onlySessionId() {
      const ids = Array.from(sessions.keys());
      if (ids.length !== 1) throw new Error(`expected 1 session, got ${ids.length}`);
      return ids[0];
    },
  };
}

function makeSlack(opts: { withUpdate?: boolean } = {}) {
  const posted: { channel: string; thread_ts?: string; text: string }[] = [];
  const updated: { channel: string; ts: string; text: string }[] = [];
  const messages = new Map<string, { channel: string; thread_ts?: string; text: string }>();
  let n = 0;
  const chat: any = {
    postMessage: vi.fn(async (msg: any) => {
      const ts = `msg-${++n}`;
      posted.push(msg);
      messages.set(ts, { channel: msg.channel, thread_ts: msg.thread_ts, text: msg.text });
      return { ok: true, ts, channel: msg.channel } as any;
    }),
  };
  // The handler only streams when chat.update exists; omit it to exercise the
  // legacy single-message path.
  if (opts.withUpdate !== false) {
    chat.update = vi.fn(async (msg: any) => {
      updated.push(msg);
      const cur = messages.get(msg.ts) ?? { channel: msg.channel, text: "" };
      messages.set(msg.ts, { ...cur, text: msg.text });
      return { ok: true } as any;
    });
  }
  return {
    posted,
    updated,
    messages,
    // Latest text of a message by ts (after any updates).
    textOf: (ts: string) => messages.get(ts)?.text,
    client: { chat } as any,
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
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local",
      fetchImpl: mock.fetchImpl,
      cwd: "/tmp/test",
      pasteSettleMs: 5,
      extractStableMs: 10,
      turnPollMs: 20,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
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

  it("recovers a tall response whose user echo scrolled off the viewport via /scrollback (claw-fcd9)", async () => {
    // A long answer pushes the user echo off the top of the 40-row viewport.
    // GET /text alone can't find the echo → extractTurn returns null → without
    // a scrollback fallback the etj7 loop burns its retries and posts a
    // misleading timeout. The handler must fetch /scrollback, prepend it, and
    // extract the FULL answer (head from scrollback + tail from the viewport).
    const req = { channelId: "C1", threadTs: "T1", text: "explain the architecture in detail", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // Scrollback = rows that scrolled off the top: the echo + the answer head.
    mock.setScrollback(id, [
      "[webterm:test] user@host claudeclaw %",
      "",
      "❯ explain the architecture in detail",
      "",
      "⏺ The system has three main layers that work together.",
      "",
      "  The first layer handles input routing and request validation.",
    ].join("\n"));
    // Viewport = the tail of the answer + footer. NO user echo here.
    mock.setText(id, [
      "  The second layer manages persistent state and the worker pool.",
      "",
      "  The third layer renders output and streams results to the caller.",
      "",
      "✻ Cooked for 4s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 (1M context) │ ⏱ 5s",
    ].join("\n"));
    mock.emitPromptReady(id);
    await p;

    expect(slack.posted).toHaveLength(1);
    const text = slack.posted[0].text;
    // Both the scrolled-off head and the visible tail must be present.
    expect(text).toContain("first layer");
    expect(text).toContain("third layer");
    // No timeout/warning, no leaked prompt chrome.
    expect(text).not.toMatch(/:warning:/);
    expect(text).not.toContain("❯");
  });

  it("keeps waiting through repeated premature prompt-readys until the answer renders (claw-fcd9/etj7)", async () => {
    // Live failure (2026-06-13): a slow/tall turn emits several prompt-readys
    // while claude is still 'Tinkering…' (no ⏺ yet). The old count-bounded loop
    // (max 3) burned its whole budget on those premature fires and posted
    // 'did not produce a response' BEFORE the answer rendered. The loop must be
    // time-bounded — keep waiting for the answer until the turn deadline, not
    // give up after N premature fires.
    const req = { channelId: "C1", threadTs: "T1", text: "count to 45", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // "Still thinking": echo present, spinner, no ⏺ → empty extraction.
    const thinking = [
      "❯ count to 45",
      "",
      "✻ Tinkering…",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ ⏱ 1s",
    ].join("\n");
    mock.setText(id, thinking);
    // Fire FOUR premature prompt-readys — past the old cap of 3.
    for (let i = 0; i < 4; i++) { mock.emitPromptReady(id); await sleep(15); }

    // The old loop would have given up by now; the time-bounded loop is still
    // waiting (no warning posted, no answer yet).
    await sleep(40);
    expect(slack.posted.some((m) => /did not produce a response|:warning:/.test(m.text))).toBe(false);

    // claude finally renders the answer.
    mock.setText(id, buildTurnGrid("count to 45", "Here are the numbers 1 through 45."));
    mock.emitPromptReady(id);
    await p;
    expect(slack.posted.some((m) => m.text.includes("1 through 45"))).toBe(true);
  });

  it("delivers via polling even when no post-completion prompt-ready fires (claw-fcd9/etj7 fix A)", async () => {
    // Root cause (real-grid probe 2026-06-13): webterm's prompt-ready fires a
    // non-deterministic count; the post-completion fire can be missed entirely,
    // so a prompt-ready-GATED loop waits the full deadline then times out. The
    // turn loop must POLL the grid for a settled answer, with prompt-ready only
    // as a fast-path accelerator.
    handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local",
      fetchImpl: mock.fetchImpl,
      cwd: "/tmp/test",
      pasteSettleMs: 5,
      extractStableMs: 10,
      turnPollMs: 20,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
    });
    const req = { channelId: "C1", threadTs: "T1", text: "count to 45", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // The answer renders, but NO turn prompt-ready ever fires (the etj7 missing
    // fire). The poll loop must still pick it up and deliver.
    mock.setText(id, buildTurnGrid("count to 45", "Here are the numbers 1 through 45."));
    await p;
    expect(slack.posted.some((m) => m.text.includes("1 through 45"))).toBe(true);
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
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
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
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
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

  it("guards against a dead claude on the hot path — second message must not type into bare zsh (H1)", async () => {
    // claude crashed/exited between turns: the PTY survives as zsh, SSE exit
    // never fires, alive stays true. Without a pre-send chrome check the
    // user's message would be EXECUTED as a shell command.
    const req1 = { channelId: "C1", threadTs: "T1", text: "first", slack: slack.client };
    const p1 = handler.handleMessage(req1);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id1 = mock.onlySessionId();
    mock.emitPromptReady(id1);
    await waitFor(() => mock.sessions.get(id1)!.inputs.length >= 4);
    mock.setText(id1, buildTurnGrid("first", "ok"));
    mock.emitPromptReady(id1);
    await p1;

    // claude dies inside the PTY — grid is now a bare zsh prompt.
    mock.setText(id1, "[webterm:test] user@host claudeclaw %");

    const req2 = { channelId: "C1", threadTs: "T1", text: "rm -rf would run here", slack: slack.client };
    const p2 = handler.handleMessage(req2);

    // A replacement session must be created; the dead one killed.
    await waitFor(() => mock.sessions.size >= 1 && [...mock.sessions.keys()].some((k) => k !== id1));
    const id2 = [...mock.sessions.keys()].find((k) => k !== id1)!;
    await waitFor(() => mock.sessions.get(id2)!.sseController !== null);
    mock.emitPromptReady(id2); // boot
    await waitFor(() => mock.sessions.get(id2)!.inputs.length >= 4);
    mock.setText(id2, buildTurnGrid("rm -rf would run here", "fresh session, treated as text"));
    mock.emitPromptReady(id2);
    await p2;

    // The message NEVER landed in the dead session.
    expect(mock.calls.find((c) => c.method === "POST" && c.url.includes(`${id1}/input`) && c.body?.data?.includes("rm -rf"))).toBeUndefined();
    expect(mock.calls.find((c) => c.method === "DELETE" && c.url.includes(id1))).toBeTruthy();
    expect(slack.posted[1].text).toContain("fresh session");
  });

  it("posts a warning instead of dying silently when the grid fetch fails mid-turn (M3)", async () => {
    let failText = false;
    const flaky: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (failText && url.includes("/text")) {
        throw new Error("ECONNREFUSED");
      }
      return mock.fetchImpl(input as any, init);
    };
    handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local",
      fetchImpl: flaky,
      cwd: "/tmp/test",
      pasteSettleMs: 5,
      extractStableMs: 10,
    });
    const req = { channelId: "C1", threadTs: "T1", text: "hi", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    failText = true; // webterm dies between prompt-ready and the grid fetch
    mock.emitPromptReady(id);
    await p;
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].text).toMatch(/:warning:/);
  });

  it("accepts the trust-folder dialog at boot and continues to the prompt (claw-g790)", async () => {
    // Captured live 2026-06-11 from claude v2.1.173 in an untrusted cwd. The
    // dialog is grid-stable, so prompt-ready fires ON it — without detection,
    // turn 1 would be typed into the dialog.
    const TRUST_DIALOG_GRID = [
      "claude --dangerously-skip-permissions",
      " Accessing workspace:",
      "",
      " /tmp/proj-x",
      "",
      " Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source",
      " project, or work from your team). If not, take a moment to review what's in this folder first.",
      "",
      " ❯ 1. Yes, I trust this folder",
      "   2. No, exit",
      "",
      " Enter to confirm · Esc to cancel",
    ].join("\n");

    const req = { channelId: "C1", threadTs: "T1", text: "hello new project", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();

    // Boot lands on the trust dialog; prompt-ready fires on the stable dialog.
    mock.setText(id, TRUST_DIALOG_GRID);
    mock.emitPromptReady(id);

    // The handler must accept it (a lone Enter, inputs[2] after boot cmd+Enter)…
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 3);
    expect(mock.sessions.get(id)!.inputs[2]).toEqual({ kind: "keys", keys: ["Enter"] });

    // …then claude boots for real.
    mock.setText(id, buildBootGrid());
    mock.emitPromptReady(id);

    // Turn proceeds normally afterwards.
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 5);
    expect(mock.sessions.get(id)!.inputs[3]).toEqual({ kind: "paste", data: "hello new project" });
    mock.setText(id, buildTurnGrid("hello new project", "trusted and ready"));
    mock.emitPromptReady(id);
    await p;
    expect(slack.posted[0].text).toContain("trusted and ready");
  });

  it("passes the per-thread working directory into session creation (claw-g790)", async () => {
    const req = {
      channelId: "C1",
      threadTs: "T1",
      text: "hi",
      cwd: "/tmp/proj-x",
      slack: slack.client,
    };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.setText(id, buildTurnGrid("hi", "in proj-x"));
    mock.emitPromptReady(id);
    await p;

    const create = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/api/sessions"));
    expect(create!.body.cwd).toBe("/tmp/proj-x");
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

  it("shutdown() drains an in-flight turn so its reply still posts (claw-wb4a)", async () => {
    // A launchd `kickstart -k` calls shutdown() mid-turn. Slack's Events API was
    // acked the moment the message arrived, so it will NEVER redeliver — an
    // in-flight turn whose reply we silently drop is lost forever. shutdown()
    // must mark the session dead (so the blocked waitForPromptReady throws and
    // the turn posts its warning) and await the in-flight turn before returning.
    const req = { channelId: "C1", threadTs: "T1", text: "mid-flight", slack: slack.client };
    const handlePromise = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    // User input sent; the turn is now blocked waiting for a turn prompt-ready
    // that the restart will never deliver.
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    await handler.shutdown();
    await handlePromise;

    // The in-flight turn resolved (posted a warning) instead of vanishing.
    expect(slack.posted.some((m) => /:warning:/.test(m.text))).toBe(true);
    expect(handler._sessionCount()).toBe(0);
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

  it("relays each prose block as its own message, including content after a ※ tip (claw-gxzq)", async () => {
    const req = { channelId: "C1", threadTs: "T1", text: "two parts", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // Block one renders (still working: active spinner, no idle prompt yet).
    // The trailing block is NOT settled by the spinner (claw-gxzq: a spinner
    // coexists with a still-growing block) — nothing posts yet; block one
    // settles when a later segment appears below it.
    mock.setText(id, [
      "❯ two parts",
      "",
      "⏺ Here is the first block.",
      "",
      "✻ Working…",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 │ ⏱ 1s",
    ].join("\n"));

    // A tip appears, then a second block — and claude goes idle.
    mock.setText(id, [
      "❯ two parts",
      "",
      "⏺ Here is the first block.",
      "",
      "※ Tip: steer me anytime.",
      "",
      "⏺ Here is the second block after the tip.",
      "",
      "✻ Cooked for 2s",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 │ ⏱ 2s",
    ].join("\n"));
    mock.emitPromptReady(id);
    // Block one posts as soon as the frame shows content below it — before the
    // turn ends (progressive relay preserved).
    await waitFor(() => slack.posted.some((m) => m.text.includes("first block")));
    await p;

    expect(slack.posted.some((m) => m.text.includes("first block"))).toBe(true);
    expect(slack.posted.some((m) => m.text.includes("second block after the tip"))).toBe(true);
    expect(slack.posted.every((m) => !m.text.includes("Tip:"))).toBe(true);
  });

  it("streams a long multi-step task with no fixed turn cap (claw-gxzq)", async () => {
    handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 15, slidingInactivityMs: 10_000,
    });
    const req = { channelId: "C1", threadTs: "T1", text: "do a long job", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    const working = (blocks: string[]) => [
      "❯ do a long job", "",
      ...blocks.flatMap((b) => [`⏺ ${b}`, ""]),
      "✻ Churning…",                      // active spinner → not idle
      "────────────────────────────────────────", "❯",
      "────────────────────────────────────────", "   Opus 4.8 │ ⏱ 9s",
    ].join("\n");

    // The trailing block never settles under a spinner (claw-gxzq) — each step
    // posts when the NEXT step's block appears below it, one block behind the
    // render edge.
    mock.setText(id, working(["Step 1 complete."]));
    mock.setText(id, working(["Step 1 complete.", "Step 2 complete."]));
    await waitFor(() => slack.posted.some((m) => m.text.includes("Step 1 complete")));
    mock.setText(id, working(["Step 1 complete.", "Step 2 complete.", "Step 3 complete."]));
    await waitFor(() => slack.posted.some((m) => m.text.includes("Step 2 complete")));

    // Finish: spinner gone, idle prompt.
    mock.setText(id, [
      "❯ do a long job", "",
      "⏺ Step 1 complete.", "", "⏺ Step 2 complete.", "", "⏺ Step 3 complete.", "", "⏺ All steps done.", "",
      "✻ Cooked for 30s",
      "────────────────────────────────────────", "❯",
      "────────────────────────────────────────", "   Opus 4.8 │ ⏱ 30s",
    ].join("\n"));
    mock.emitPromptReady(id);
    await p;
    expect(slack.posted.some((m) => m.text.includes("All steps done"))).toBe(true);
    expect(slack.posted.every((m) => !/:warning:/.test(m.text))).toBe(true);
  });

  it("aborts a wedged session after the sliding inactivity window (claw-gxzq)", async () => {
    handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 10, slidingInactivityMs: 60,
    });
    const req = { channelId: "C1", threadTs: "T1", text: "hang please", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // Frozen, non-idle, no spinner, no ⏺ → wedged.
    mock.setText(id, ["❯ hang please", "", "  (no output)"].join("\n"));
    await p;
    expect(slack.posted.some((m) => /:warning:.*stopped responding/.test(m.text))).toBe(true);
  });
});

describe("live-activity streaming (claw-1ta5)", () => {
  let mock: ReturnType<typeof makeMockWebterm>;
  let slack: ReturnType<typeof makeSlack>;
  let handler: WebtermRuntimeHandler;

  beforeEach(() => {
    mock = makeMockWebterm();
    slack = makeSlack();
    handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local",
      fetchImpl: mock.fetchImpl,
      cwd: "/tmp/test",
      pasteSettleMs: 5,
      extractStableMs: 10,
      turnPollMs: 20,
      streamStatus: true,
      statusPollMs: 10,
    });
  });

  async function bootTo(req: any): Promise<string> {
    handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4); // boot cmd + paste
    return id;
  }

  it("posts a placeholder, streams live activity, and resolves the SAME message into the answer", async () => {
    const handlePromise = handler.handleMessage({ channelId: "C1", threadTs: "T1", text: "do a thing", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // Placeholder posted immediately.
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].text).toBe("_🐾 on it…_");

    // Mid-turn: a tool is running — the status loop should reflect it.
    mock.setText(id, ["❯ do a thing", "", "⏺ Bash(ls -la)", "✻ Crunched for 1s"].join("\n"));
    await waitFor(() => slack.updated.some((u) => u.text.includes("running a command")));

    // Turn completes.
    mock.setText(id, buildTurnGrid("do a thing", "all done!"));
    mock.emitPromptReady(id);
    await handlePromise;

    // The placeholder became the answer; the only other post is the tool
    // recap line (claw-zlr4) — no duplicate answer message.
    const nonRecap = slack.posted.filter((m) => !/🔧 \d+ tool call/.test(m.text));
    expect(nonRecap).toHaveLength(1);
    expect(slack.textOf("msg-1")).toContain("all done!");
    // The final ANSWER write to the placeholder is the answer, not a stale
    // status line.
    const placeholderWrites = slack.updated.filter((u) => u.ts === "msg-1");
    expect(placeholderWrites[placeholderWrites.length - 1].text).toContain("all done!");
  });

  it("delivers the answer via chat.update, never a new message", async () => {
    const req = { channelId: "C1", threadTs: "T1", text: "hi", slack: slack.client };
    const id = await bootTo(req);
    mock.setText(id, buildTurnGrid("hi", "hello there"));
    mock.emitPromptReady(id);
    await waitFor(() => slack.textOf("msg-1")?.includes("hello there") ?? false);
    expect(slack.posted).toHaveLength(1); // only the placeholder was posted
  });

  it("falls back to a single message when the Slack client lacks chat.update", async () => {
    slack = makeSlack({ withUpdate: false });
    handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, streamStatus: true, statusPollMs: 10,
    });
    const req = { channelId: "C1", threadTs: "T1", text: "hi", slack: slack.client };
    const id = await bootTo(req);
    mock.setText(id, buildTurnGrid("hi", "no streaming here"));
    mock.emitPromptReady(id);
    await waitFor(() => slack.posted.some((m) => m.text.includes("no streaming here")));
    // No placeholder, just the final answer as one message.
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].text).toContain("no streaming here");
  });

  it("falls back to postMessage if the placeholder post fails", async () => {
    // postMessage throws once (placeholder), then works (fallback final).
    let calls = 0;
    slack.client.chat.postMessage = vi.fn(async (msg: any) => {
      calls++;
      if (calls === 1) throw new Error("slack down");
      slack.posted.push(msg);
      return { ok: true, ts: `late-${calls}` } as any;
    });
    const req = { channelId: "C1", threadTs: "T1", text: "hi", slack: slack.client };
    const id = await bootTo(req);
    mock.setText(id, buildTurnGrid("hi", "recovered answer"));
    mock.emitPromptReady(id);
    await waitFor(() => slack.posted.some((m) => m.text.includes("recovered answer")));
    expect(slack.updated).toHaveLength(0); // no statusTs → no updates
  });

  it("streams an error into the placeholder on turn timeout (no orphan placeholder)", async () => {
    const handler2 = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, streamStatus: true, statusPollMs: 10,
    });
    // Drive boot only; never fire the turn prompt-ready → timeout path.
    // Use a tiny turn timeout by monkey-not-available; instead simulate by
    // letting the session die so waitForPromptReady throws quickly.
    const req = { channelId: "C1", threadTs: "T1", text: "stuck", slack: slack.client };
    handler2.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    expect(slack.posted[0].text).toBe("_🐾 on it…_");
    // Session dies → waitForPromptReady throws → error delivered into placeholder.
    mock.emitExit(id, 1);
    await waitFor(() => slack.textOf("msg-1")?.includes(":warning:") ?? false);
    expect(slack.posted).toHaveLength(1); // placeholder reused for the error
  });

  it("grows a message per prose block and opens a fresh message after a tool boundary (claw-gxzq)", async () => {
    const handlePromise = handler.handleMessage({ channelId: "C1", threadTs: "T1", text: "stream please", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // Placeholder posted.
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0].text).toBe("_🐾 on it…_");

    // Block one grows in the placeholder message (msg-1) while working.
    const working = (lines: string[]) => [
      "❯ stream please", "", ...lines, "",
      "✻ Working…",
      "────────────────────────────────────────", "❯",
      "────────────────────────────────────────", "   Opus 4.8 │ ⏱ 1s",
    ].join("\n");
    mock.setText(id, working(["⏺ Block one, partial…"]));
    await waitFor(() => (slack.textOf("msg-1") ?? "").includes("Block one"));

    // A tool runs (finalizes block one), then block two starts → fresh message.
    mock.setText(id, working(["⏺ Block one, partial… now complete.", "", "⏺ Bash(ls)", "  ⎿ ok", "", "⏺ Block two here."]));
    await waitFor(() => slack.posted.length >= 2 && slack.posted.some((m) => m.text.includes("Block two")));

    // Idle finish.
    mock.setText(id, [
      "❯ stream please", "",
      "⏺ Block one, partial… now complete.", "", "⏺ Bash(ls)", "  ⎿ ok", "", "⏺ Block two here.", "",
      "✻ Cooked for 3s",
      "────────────────────────────────────────", "❯",
      "────────────────────────────────────────", "   Opus 4.8 │ ⏱ 3s",
    ].join("\n"));
    mock.emitPromptReady(id);
    await handlePromise;

    expect(slack.textOf("msg-1")).toContain("Block one");
    // Block one's message must hold its FINAL text, not the spinner-time partial
    // (Fix 1 claw-gxzq): both frames carried "✻ Working…", so the pre-fix
    // settledCount finalized block one at "Block one, partial…" and froze it.
    expect(slack.textOf("msg-1")).toContain("now complete");
    expect(slack.posted.some((m) => m.text.includes("Block two"))).toBe(true);
    // The tool invocation text never becomes a posted message body.
    expect(slack.posted.every((m) => !m.text.includes("Bash(ls)"))).toBe(true);
  });

  it("grows a still-rendering prose block in place before it settles (claw-gxzq)", async () => {
    const handlePromise = handler.handleMessage({ channelId: "C1", threadTs: "T1", text: "tell me", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);

    // A prose block mid-render: no active spinner, no idle prompt yet. The
    // discrete path holds it back (settledCount = len-1 = 0); the streaming path
    // must GROW it into the placeholder (msg-1) via chat.update.
    mock.setText(id, ["❯ tell me", "", "⏺ The answer is unfolding"].join("\n"));
    await waitFor(() => (slack.textOf("msg-1") ?? "").includes("unfolding"));
    expect(slack.posted).toHaveLength(1); // grew the placeholder, no new message

    // The same block keeps growing in the SAME message.
    mock.setText(id, ["❯ tell me", "", "⏺ The answer is unfolding nicely now."].join("\n"));
    await waitFor(() => (slack.textOf("msg-1") ?? "").includes("nicely now"));
    expect(slack.posted).toHaveLength(1);

    // Idle finish resolves the block in place — still one message.
    mock.setText(id, buildTurnGrid("tell me", "The answer is unfolding nicely now. Done."));
    mock.emitPromptReady(id);
    await handlePromise;
    expect(slack.textOf("msg-1")).toContain("Done.");
    expect(slack.posted).toHaveLength(1);
  });

  it("throttles the growing-block chat.update path to MIN_STATUS_UPDATE_MS (claw-uu2u A1)", async () => {
    // Large turnPollMs/statusPollMs so only emitOutputChunk drives the relay
    // loop — isolates the SSE-cadence wake path A1 targets (real webterm
    // fires output-chunk on ~50ms flush, which is what made the growing
    // branch fire several times/sec before this fix).
    const throttleHandler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local",
      fetchImpl: mock.fetchImpl,
      cwd: "/tmp/test",
      pasteSettleMs: 5,
      extractStableMs: 10,
      turnPollMs: 60_000,
      streamStatus: true,
      statusPollMs: 10,
    });
    const handlePromise = throttleHandler.handleMessage({ channelId: "C1", threadTs: "T1", text: "stream please", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    expect(slack.posted).toHaveLength(1); // placeholder only

    // 10 rapid ticks (~15ms apart, well inside the 1500ms throttle floor) —
    // each changes the trailing block's text, so an unthrottled relay would
    // chat.update on every one.
    for (let i = 1; i <= 10; i++) {
      mock.setText(id, ["❯ stream please", "", `⏺ Growing block tick ${i}...`].join("\n"));
      mock.emitOutputChunk(id);
      await sleep(15);
    }

    const growUpdatesDuringBurst = slack.updated.filter((u) => u.ts === "msg-1").length;
    expect(growUpdatesDuringBurst).toBeGreaterThan(0); // the first tick still gets through
    expect(growUpdatesDuringBurst).toBeLessThanOrEqual(3); // throttled well below the 10 ticks fired

    // Finalize — the FINAL text must land exactly regardless of the throttle
    // (the finalize/deliver paths bypass it).
    mock.setText(id, buildTurnGrid("stream please", "Growing block tick 10... Done."));
    mock.emitPromptReady(id);
    await handlePromise;
    expect(slack.textOf("msg-1")).toContain("Growing block tick 10... Done.");
  });
});

// claw-gxzq trailing-body drop (2026-07-03): 200ms frame captures of a live
// turn show claude REMOVES the spinner line while streaming prose into the
// transcript, so a mid-render grid satisfies isGridIdle while the trailing ⏺
// block is only its header ("Step 1 — Octopus fun fact:" with the fact still
// rendering). Finalizing on a SINGLE idle observation ships that partial text
// and the postedSegments high-water mark never repairs it. The relay must gate
// trailing-block finalization on STABLE idle: idle across IDLE_STABLE_POLLS
// consecutive observations with NO grid change in between.
//
// These tests drive the turn loop deterministically: turnPollMs is huge, so
// the loop iterates exactly once per emitPromptReady; the mock's `calls` log
// tells us when an iteration's grid fetch has happened. Swapping setText after
// that is race-free — the iteration already holds the grid it fetched.
describe("trailing-block settle gating (claw-gxzq idle-flap)", () => {
  let mock: ReturnType<typeof makeMockWebterm>;
  let slack: ReturnType<typeof makeSlack>;

  beforeEach(() => {
    mock = makeMockWebterm();
    slack = makeSlack();
  });

  const textFetches = () => mock.calls.filter((c) => c.method === "GET" && /\/text$/.test(c.url)).length;

  async function bootTo(handler: WebtermRuntimeHandler, req: any): Promise<{ id: string; p: Promise<void> }> {
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    return { id, p };
  }

  // One loop iteration: wake via prompt-ready, wait until its grid fetch lands.
  async function iterate(id: string): Promise<void> {
    const n = textFetches();
    mock.emitPromptReady(id);
    await waitFor(() => textFetches() > n);
  }

  const idleLooking = (blockLines: string[], clock: string) => [
    "❯ tell me",
    "",
    ...blockLines,
    "",
    "────────────────────────────────────────",
    "❯",
    "────────────────────────────────────────",
    `   Sonnet 4.6 │ ⏱ ${clock}`,
  ].join("\n");

  // In the streaming tests the loop's reaction to each frame is observed via
  // Slack writes (grow/deliver touches a message on every relevant frame in
  // both the buggy and fixed worlds), because the status loop's grid fetches
  // would make a fetch-count observable ambiguous. The body frame is raced
  // against turn-end: the buggy relay goes silent there and just ends the turn.
  const anyMessageContains = (s: ReturnType<typeof makeSlack>, needle: string) =>
    [...s.messages.values()].some((m) => m.text.includes(needle));

  it("streaming: a transient idle-looking frame must not finalize the trailing block", async () => {
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 60_000,
      streamStatus: true, statusPollMs: 10,
    });
    const req = { channelId: "C1", threadTs: "T1", text: "tell me", slack: slack.client };
    const { id, p } = await bootTo(handler, req);

    // Poison frame: header rendered, no spinner anywhere, prompt box present —
    // exactly the captured 08-stream-flap-2 shape. Reads idle; body not there.
    mock.setText(id, idleLooking(["⏺ Step 1 — Octopus fun fact:"], "1s"));
    mock.emitPromptReady(id);
    await waitFor(() => anyMessageContains(slack, "fun fact:"));

    // 500ms later (next frame in the capture): the SAME block has its body on
    // an equally idle-looking grid.
    mock.setText(id, idleLooking(["⏺ Step 1 — Octopus fun fact:", "  Octopuses have three hearts."], "2s"));
    mock.emitPromptReady(id);
    await Promise.race([
      p,
      waitFor(() => anyMessageContains(slack, "three hearts")).catch(() => {}),
    ]);

    // Grid frozen → stable idle → finalize + turn end.
    mock.emitPromptReady(id);
    await p;

    const all = [...slack.messages.values()].map((m) => m.text).join("\n---\n");
    expect(all).toContain("three hearts");
  });

  it("discrete: the trailing block posts complete, never at its poison-frame text", async () => {
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 60_000,
    });
    slack = makeSlack({ withUpdate: false }); // no chat.update → discrete path
    const req = { channelId: "C1", threadTs: "T1", text: "tell me", slack: slack.client };
    const { id, p } = await bootTo(handler, req);

    mock.setText(id, idleLooking(["⏺ Step 1 — Octopus fun fact:"], "1s"));
    await iterate(id);

    mock.setText(id, idleLooking(["⏺ Step 1 — Octopus fun fact:", "  Octopuses have three hearts."], "2s"));
    await iterate(id);

    mock.emitPromptReady(id);
    await p;

    expect(slack.posted.length).toBe(1);
    expect(slack.posted[0].text).toContain("three hearts");
  });

  it("streaming: real captured turn-end frames — the haiku body survives (fixtures 09)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const load = (name: string) => {
      const raw = readFileSync(join(__dirname, "..", "test", "fixtures", "webterm-grids", `${name}.txt`), "utf-8");
      const u = "__USER_INPUT__\n"; const g = "\n__GRID__\n"; const s = "\n__SCROLLBACK__\n";
      return {
        userInput: raw.slice(raw.indexOf(u) + u.length, raw.indexOf(g)),
        grid: raw.slice(raw.indexOf(g) + g.length, raw.indexOf(s)),
      };
    };
    const header = load("09-turnend-flap-1-header");
    const body = load("09-turnend-flap-2-body");

    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 60_000,
      streamStatus: true, statusPollMs: 10,
    });
    const req = { channelId: "C1", threadTs: "T1", text: header.userInput, slack: slack.client };
    const { id, p } = await bootTo(handler, req);

    mock.setText(id, header.grid); // idle-looking, "Step 3 — Terminal haiku:" header only
    mock.emitPromptReady(id);
    await waitFor(() => anyMessageContains(slack, "Terminal haiku:"));

    mock.setText(id, body.grid);   // 550ms later: haiku rendered, grid truly idle
    mock.emitPromptReady(id);
    await Promise.race([
      p,
      waitFor(() => anyMessageContains(slack, "Cursor blinks")).catch(() => {}),
    ]);

    mock.emitPromptReady(id);      // unchanged → stable idle → finalize + end
    await p;

    const all = [...slack.messages.values()].map((m) => m.text).join("\n---\n");
    expect(all).toContain("Cursor blinks and waits");
    expect(all).toContain("the shell breathes them in.");
  });
});

describe("idle session reaping (claw-9nvw)", () => {
  let mock: ReturnType<typeof makeMockWebterm>;
  let handler: WebtermRuntimeHandler;

  beforeEach(() => {
    mock = makeMockWebterm();
    handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local",
      fetchImpl: mock.fetchImpl,
      cwd: "/tmp/test",
      pasteSettleMs: 5,
      extractStableMs: 10,
      turnPollMs: 20,
      idleReapMs: 60_000,
      reapIntervalMs: 0, // timer off — tests drive reapIdleSessions() directly
    });
  });

  it("reaps slack-bot sessions idle past the threshold, including unmapped orphans", async () => {
    mock.seedSession("sess-stale", "slack-bot C1::Told", buildBootGrid(), Date.now() - 120_000);
    mock.seedSession("sess-fresh", "slack-bot C1::Tnew", buildBootGrid(), Date.now() - 5_000);

    const reaped = await handler.reapIdleSessions();

    expect(reaped).toBe(1);
    expect(mock.calls.find((c) => c.method === "DELETE" && c.url.includes("sess-stale"))).toBeTruthy();
    expect(mock.calls.find((c) => c.method === "DELETE" && c.url.includes("sess-fresh"))).toBeUndefined();
  });

  it("never reaps sessions that are not slack-bot titled", async () => {
    mock.seedSession("sess-user", "my interactive terminal", buildBootGrid(), Date.now() - 999_999);
    expect(await handler.reapIdleSessions()).toBe(0);
    expect(mock.calls.find((c) => c.method === "DELETE")).toBeUndefined();
  });

  it("removes reaped sessions from the local map so the next message recreates", async () => {
    const slack = makeSlack();
    // Establish a mapped session via a normal turn.
    const p = handler.handleMessage({ channelId: "C1", threadTs: "T1", text: "hi", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.setText(id, buildTurnGrid("hi", "hello"));
    mock.emitPromptReady(id);
    await p;
    expect(handler._sessionCount()).toBe(1);

    // Make it stale and reap.
    mock.sessions.get(id)!.lastActivityAt = Date.now() - 120_000;
    expect(await handler.reapIdleSessions()).toBe(1);
    expect(handler._sessionCount()).toBe(0);
    expect(mock.calls.find((c) => c.method === "DELETE" && c.url.includes(id))).toBeTruthy();
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
  it("strips the '*Sent using* Claude' transport suffix", () => {
    expect(decodeSlackEntities("real question here *Sent using* Claude")).toBe("real question here");
    expect(decodeSlackEntities("multi\nline\n*Sent using* Claude")).toBe("multi\nline");
  });
  it("does not strip 'Sent using Claude' mid-message", () => {
    expect(decodeSlackEntities("*Sent using* Claude is a suffix, this isn't")).toBe(
      "*Sent using* Claude is a suffix, this isn't",
    );
  });
});

describe("direct-spawn session creation (claw-3btg.1)", () => {
  let mock: ReturnType<typeof makeMockWebterm>;
  let slack: ReturnType<typeof makeSlack>;
  let handler: WebtermRuntimeHandler;

  beforeEach(() => {
    mock = makeMockWebterm();
    slack = makeSlack();
    handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local",
      fetchImpl: mock.fetchImpl,
      cwd: "/tmp/test",
      pasteSettleMs: 5,
      extractStableMs: 10,
      turnPollMs: 20,
      directSpawnCommand: ["/opt/bin/claude", "--dangerously-skip-permissions"],
    });
  });

  it("creates the session with a command argv and never types a boot command into a shell", async () => {
    const req = { channelId: "C1", threadTs: "1234.5", text: "what is 2+2?", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    // claude IS the PTY child — first prompt-ready is the claude prompt.
    mock.emitPromptReady(id);
    // The FIRST inputs are the user's message (paste + Enter) — no boot input.
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 2);
    mock.setText(id, buildTurnGrid(req.text, "2 plus 2 equals 4."));
    mock.emitPromptReady(id);
    await p;

    const create = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/api/sessions"))!;
    expect(create.body.command.slice(0, 2)).toEqual(["/opt/bin/claude", "--dangerously-skip-permissions"]);
    expect(create.body.command[2]).toBe("--append-system-prompt");
    // Channel context rides as a raw argv element — no shell quoting layer.
    expect(create.body.command[3]).toContain("channel ID: C1");
    expect(create.body.command[3]).toContain("thread: 1234.5");

    const inputs = mock.sessions.get(id)!.inputs;
    expect(inputs[0].data).toContain("what is 2+2?");
    for (const i of inputs) {
      expect(i.data ?? "").not.toContain("--append-system-prompt");
    }
    expect(slack.posted[0].text).toContain("2 plus 2 equals 4.");
  });

  it("legacy shell mode is unchanged: no command argv in the create body", async () => {
    const legacy = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local",
      fetchImpl: mock.fetchImpl,
      cwd: "/tmp/test",
      pasteSettleMs: 5,
      extractStableMs: 10,
      turnPollMs: 20,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
    });
    const req = { channelId: "C1", threadTs: "T9", text: "hi", slack: slack.client };
    const p = legacy.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot done
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.setText(id, buildTurnGrid("hi", "hello"));
    mock.emitPromptReady(id);
    await p;

    const create = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/api/sessions"))!;
    expect(create.body.command).toBeUndefined();
    // Boot command was typed into the shell (legacy path).
    const inputs = mock.sessions.get(id)!.inputs;
    expect(inputs[0].data).toContain("--append-system-prompt");
  });
});

describe("wave2 primitives (claw-3btg.2/.3/.4/.8)", () => {
  let mock: ReturnType<typeof makeMockWebterm>;
  let slack: ReturnType<typeof makeSlack>;

  beforeEach(() => {
    mock = makeMockWebterm();
    slack = makeSlack();
  });

  it("/wait wakes the turn loop: completes with a huge poll interval and no post-answer prompt-ready", async () => {
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 60_000,
    });
    const req = { channelId: "C1", threadTs: "T1", text: "ping", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id); // boot only — never again
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.setText(id, buildTurnGrid("ping", "pong answer"));
    await p; // without /wait pacing this would hang for turnPollMs=60s and time out
    expect(slack.posted.map((m) => m.text).join("\n")).toContain("pong answer");
  }, 8000);

  it("input to a retained dead session posts the exit cause (409 path)", async () => {
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20,
    });
    const req1 = { channelId: "C1", threadTs: "T2", text: "first", slack: slack.client };
    const p1 = handler.handleMessage(req1);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.setText(id, buildTurnGrid("first", "done one"));
    mock.emitPromptReady(id);
    await p1;

    // claude dies inside the PTY; the frozen grid still matches the model-row
    // regex, so the hot-path guard passes — the 409 is the wall that holds.
    mock.sessions.get(id)!.alive = false;
    mock.sessions.get(id)!.exitCode = 137;
    const req2 = { channelId: "C1", threadTs: "T2", text: "second", slack: slack.client };
    await handler.handleMessage(req2);
    const all = slack.posted.map((m) => m.text).join("\n");
    expect(all).toContain("session exited (code 137)");
  });

  it("stable-idle gate defers while the screen is still painting (lastOutputMs floor, claw-3btg.4)", async () => {
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, idleOutputFloorMs: 250,
    });
    const req = { channelId: "C1", threadTs: "T3", text: "paint", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    // Answer grid arrives but output is FRESH — an idle-looking frame mid-paint.
    mock.setLastOutputMs(id, 0);
    mock.setText(id, buildTurnGrid("paint", "half-rendered answer"));
    await sleep(150);
    expect(slack.posted).toHaveLength(0); // floor held the finalize back
    mock.setLastOutputMs(id, 5_000); // paint settled
    await p;
    expect(slack.posted.map((m) => m.text).join("\n")).toContain("half-rendered answer");
  });

  it("mid-turn death posts the exit cause from the retained session (claw-3btg.2)", async () => {
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/test",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20,
    });
    const req = { channelId: "C1", threadTs: "T4", text: "doomed", slack: slack.client };
    const p = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const id = mock.onlySessionId();
    mock.emitPromptReady(id);
    await waitFor(() => mock.sessions.get(id)!.inputs.length >= 4);
    mock.emitExit(id, 1); // claude crashes mid-turn
    await p;
    const all = slack.posted.map((m) => m.text).join("\n");
    expect(all).toContain("lost the webterm session mid-turn");
    expect(all).toContain("code 1");
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

describe("SSE gate + event-driven wake (claw-kdqv, claw-rr2x)", () => {
  it("subscribes with the etj7 activity-gate params", async () => {
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
    });
    const turn = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "hi", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const sid = mock.onlySessionId();
    mock.setText(sid, buildBootGrid());
    mock.emitPromptReady(sid);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "paste"));
    mock.setText(sid, buildTurnGrid("hi", "hello there"));
    mock.emitPromptReady(sid);
    await turn;
    const sseCall = mock.calls.find((c) => c.url.includes("/events"));
    expect(sseCall).toBeDefined();
    expect(sseCall!.url).toContain("promptReadyMinChangesAfterInput=2");
    expect(sseCall!.url).toContain("promptReadyMaxQuietMs=5000");
    await handler.shutdown({ killSessions: true });
  });

  it("output-chunk SSE wakes the turn loop when /wait is unsupported", async () => {
    const mock = makeMockWebterm();
    mock.flags.waitSupported = false;
    const slack = makeSlack();
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      // Poll timer far beyond the test timeout: only an SSE wake can finish this turn fast.
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 8_000, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
    });
    const turn = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "hi", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const sid = mock.onlySessionId();
    mock.setText(sid, buildBootGrid());
    mock.emitPromptReady(sid);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "paste"));
    mock.setText(sid, buildTurnGrid("hi", "hello there"));
    mock.emitOutputChunk(sid);
    // Idle-confirmation waits use min(turnPollMs, extractStableMs)=10ms, so the
    // only long sleep is the FIRST wait — which output-chunk must break.
    await Promise.race([
      turn,
      new Promise((_, rej) => setTimeout(() => rej(new Error("turn did not complete — SSE wake missing")), 4_000)),
    ]);
    expect(slack.posted.length + slack.updated.length).toBeGreaterThan(0);
    await handler.shutdown({ killSessions: true });
  }, 10_000);
});

describe("hardened turn-end + tripwire (claw-46g8)", () => {
  function idleGridNoFooter(userInput: string, blocks: string[]): string {
    // Idle-LOOKING: prompt box present, no active spinner — but also no
    // past-tense completion footer. This is the mid-answer pause signature.
    return [
      `❯ ${userInput}`,
      "",
      ...blocks.flatMap((b) => [`⏺ ${b}`, ""]),
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 (1M context) │ ⏱ 5s",
    ].join("\n");
  }
  function doneGrid(userInput: string, blocks: string[]): string {
    return [
      `❯ ${userInput}`,
      "",
      ...blocks.flatMap((b) => [`⏺ ${b}`, ""]),
      "✻ Cooked for 12s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 (1M context) │ ⏱ 12s",
    ].join("\n");
  }

  async function bootTurn(mock: ReturnType<typeof makeMockWebterm>, slack: ReturnType<typeof makeSlack>, handlerOpts: any, text = "three parts") {
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      turnEndQuietMs: 150,
      tripwireDelayMs: 10,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      ...handlerOpts,
    });
    const turn = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text, slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const sid = mock.onlySessionId();
    mock.setText(sid, buildBootGrid());
    mock.emitPromptReady(sid);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "paste"));
    return { handler, turn, sid };
  }

  it("a frozen idle grid WITHOUT the completion footer does not end the turn (haiku drop)", async () => {
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const { handler, turn, sid } = await bootTurn(mock, slack, { turnEndQuietMs: 5_000, tripwireDelayMs: 10 });
    let settled = false;
    void turn.then(() => { settled = true; }, () => { settled = true; });

    mock.setText(sid, idleGridNoFooter("three parts", ["Part one.", "Part two."]));
    mock.emitOutputChunk(sid);
    await new Promise((r) => setTimeout(r, 400));
    expect(settled).toBe(false); // would have finalized at ~3 stable polls before claw-46g8

    // claude finishes: part three + past-tense footer → turn completes with ALL parts.
    mock.setText(sid, doneGrid("three parts", ["Part one.", "Part two.", "Part three haiku."]));
    mock.emitOutputChunk(sid);
    await turn;
    const allText = [...slack.posted.map((p) => p.text), ...slack.updated.map((u) => u.text)].join("\n");
    expect(allText).toContain("Part three haiku.");
    await handler.shutdown({ killSessions: true });
  }, 10_000);

  it("footerless turns still finalize after the quiet fallback window", async () => {
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const { handler, turn, sid } = await bootTurn(mock, slack, { turnEndQuietMs: 150, tripwireDelayMs: 10 });
    mock.setText(sid, idleGridNoFooter("three parts", ["Only part."]));
    mock.emitOutputChunk(sid);
    await turn;
    const allText = [...slack.posted.map((p) => p.text), ...slack.updated.map((u) => u.text)].join("\n");
    expect(allText).toContain("Only part.");
    await handler.shutdown({ killSessions: true });
  }, 10_000);

  it("tripwire posts content that appears after finalization", async () => {
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const { handler, turn, sid } = await bootTurn(mock, slack, { turnEndQuietMs: 5_000, tripwireDelayMs: 250 });
    mock.setText(sid, doneGrid("three parts", ["Part one."]));
    mock.emitOutputChunk(sid);
    // Wait for delivery, then sneak a late block onto the grid inside the tripwire window.
    await waitFor(() => [...slack.posted.map((p) => p.text), ...slack.updated.map((u) => u.text)].some((t) => t.includes("Part one.")));
    mock.setText(sid, doneGrid("three parts", ["Part one.", "The late haiku."]));
    await turn;
    const continued = slack.posted.find((p) => p.text.includes("…continued") && p.text.includes("The late haiku."));
    expect(continued).toBeDefined();
    await handler.shutdown({ killSessions: true });
  }, 10_000);
});

describe("tool timeline recap (claw-zlr4)", () => {
  it("posts a muted recap line after a turn that used tools", async () => {
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
    });
    const turn = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "count files", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const sid = mock.onlySessionId();
    mock.setText(sid, buildBootGrid());
    mock.emitPromptReady(sid);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "paste"));
    mock.setText(sid, [
      "❯ count files",
      "",
      "⏺ Bash(ls | wc -l)",
      "  ⎿ 13",
      "",
      "⏺ There are 13 files.",
      "",
      "✻ Cooked for 3s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 (1M context) │ ⏱ 3s",
    ].join("\n"));
    mock.emitOutputChunk(sid);
    await turn;
    const recap = slack.posted.find((m) => /🔧 1 tool call · \d+s/.test(m.text));
    expect(recap).toBeDefined();
    await handler.shutdown({ killSessions: true });
  }, 10_000);
});

describe("presence: reactions, typing status, abort (claw-fs45, claw-jfui)", () => {
  function makeSlackWithReactions() {
    const base = makeSlack();
    const reactions = { added: [] as any[], removed: [] as any[] };
    (base.client as any).reactions = {
      add: vi.fn(async (a: any) => { reactions.added.push(a); return { ok: true }; }),
      remove: vi.fn(async (a: any) => { reactions.removed.push(a); return { ok: true }; }),
    };
    return { ...base, reactions };
  }

  async function boot(mock: ReturnType<typeof makeMockWebterm>, handler: WebtermRuntimeHandler, req: any) {
    const turn = handler.handleMessage(req);
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const sid = mock.onlySessionId();
    mock.setText(sid, buildBootGrid());
    mock.emitPromptReady(sid);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "paste"));
    return { turn, sid };
  }

  it("👀 during the turn, ✅ after a clean turn; typing status set then cleared", async () => {
    const mock = makeMockWebterm();
    const slack = makeSlackWithReactions();
    const statuses: string[] = [];
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
    });
    const { turn, sid } = await boot(mock, handler, {
      channelId: "C1", threadTs: "1.0", text: "hi", userTs: "u-1", slack: slack.client,
      setThreadStatus: async (st: string) => { statuses.push(st); },
    });
    mock.setText(sid, buildTurnGrid("hi", "hello!"));
    mock.emitOutputChunk(sid);
    await turn;
    expect(slack.reactions.added.map((a) => a.name)).toEqual(["eyes", "white_check_mark"]);
    expect(slack.reactions.removed.map((a) => a.name)).toEqual(["eyes"]);
    expect(statuses[0]).toBe("is working…");
    expect(statuses[statuses.length - 1]).toBe("");
    await handler.shutdown({ killSessions: true });
  }, 10_000);

  it("⚠️ replaces ✅ when the turn delivered a warning", async () => {
    const mock = makeMockWebterm();
    const slack = makeSlackWithReactions();
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10, slidingInactivityMs: 100,
    });
    const { turn, sid } = await boot(mock, handler, {
      channelId: "C1", threadTs: "1.0", text: "hi", userTs: "u-1", slack: slack.client,
    });
    // Never idle, never changing: grid WITHOUT a prompt box → wedge guard fires.
    mock.setText(sid, ["❯ hi", "", "✳ Nesting… (5s · ↓ 12 tokens)"].join("\n"));
    mock.emitOutputChunk(sid);
    await turn;
    expect(slack.reactions.added.map((a) => a.name)).toEqual(["eyes", "warning"]);
    await handler.shutdown({ killSessions: true });
  }, 10_000);

  it("abortTurn sends Escape to the in-flight session and reports idle threads", async () => {
    const mock = makeMockWebterm();
    const slack = makeSlackWithReactions();
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
    });
    expect(await handler.abortTurn("C1", "1.0")).toBe(false); // nothing running
    const { turn, sid } = await boot(mock, handler, {
      channelId: "C1", threadTs: "1.0", text: "long task", slack: slack.client,
    });
    // Turn is mid-flight (no end evidence on the grid).
    mock.setText(sid, ["❯ long task", "", "✳ Working… (2s)"].join("\n"));
    mock.emitOutputChunk(sid);
    expect(handler.hasInFlight("C1", "1.0")).toBe(true);
    expect(await handler.abortTurn("C1", "1.0")).toBe(true);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "keys" && i.keys?.includes("Escape")));
    // claude interrupts → prompt returns with footer; turn finalizes normally.
    mock.setText(sid, buildTurnGrid("long task", "stopped early."));
    mock.emitOutputChunk(sid);
    await turn;
    await handler.shutdown({ killSessions: true });
  }, 10_000);
});

describe("per-turn log + barrier de-noise (claw-za0o)", () => {
  it("emits one structured 'Turn complete' INFO per turn", async () => {
    const { Logger } = await import("./logger");
    const infoSpy = vi.spyOn(Logger.prototype, "info");
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
    });
    const turn = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "hi", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const sid = mock.onlySessionId();
    mock.setText(sid, buildBootGrid());
    mock.emitPromptReady(sid);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "paste"));
    mock.setText(sid, buildTurnGrid("hi", "hello!"));
    mock.emitOutputChunk(sid);
    await turn;
    const complete = infoSpy.mock.calls.filter((c) => c[0] === "Turn complete");
    expect(complete).toHaveLength(1);
    expect(complete[0][1]).toMatchObject({ threadKey: "C1::1.0", outcome: "ok" });
    expect(complete[0][1].ms).toBeGreaterThanOrEqual(0);
    infoSpy.mockRestore();
    await handler.shutdown({ killSessions: true });
  }, 10_000);

  it("echoed:false on a session's first turn logs debug, not warn", async () => {
    const { Logger } = await import("./logger");
    const warnSpy = vi.spyOn(Logger.prototype, "warn");
    const mock = makeMockWebterm();
    // Force echoed:false on every input ack.
    const origFetch = mock.fetchImpl;
    const fetchImpl: typeof fetch = async (input, init) => {
      const res = await origFetch(input, init);
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/input") && res.status === 200) {
        const body = (await res.json()) as Record<string, unknown>;
        return new Response(JSON.stringify({ ...body, echoed: false }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return res;
    };
    const slack = makeSlack();
    const handler = new WebtermRuntimeHandler({
      sessionStorePath: freshStorePath(),
      resumeFileCheck: () => false,
      webtermUrl: "http://test.local", fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
    });
    const turn = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "hi", slack: slack.client });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const sid = mock.onlySessionId();
    mock.setText(sid, buildBootGrid());
    mock.emitPromptReady(sid);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "paste"));
    mock.setText(sid, buildTurnGrid("hi", "hello!"));
    mock.emitOutputChunk(sid);
    await turn;
    const echoWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("input not echoed"));
    expect(echoWarns).toHaveLength(0);
    warnSpy.mockRestore();
    await handler.shutdown({ killSessions: true });
  }, 10_000);
});

describe("session resume across reaps (claw-m7bj, claw-8262)", () => {
  async function driveBoot(mock: ReturnType<typeof makeMockWebterm>, expectSessions = 1) {
    await waitFor(() => mock.sessions.size === expectSessions && [...mock.sessions.values()].pop()!.sseController !== null);
    const sid = [...mock.sessions.keys()].pop()!;
    mock.setText(sid, buildBootGrid());
    mock.emitPromptReady(sid);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "paste"));
    return sid;
  }
  async function finishTurn(mock: ReturnType<typeof makeMockWebterm>, sid: string, text: string, answer: string) {
    mock.setText(sid, buildTurnGrid(text, answer));
    mock.emitOutputChunk(sid);
  }

  it("first boot pins --session-id; recreation after reap boots with --resume", async () => {
    const storePath = freshStorePath();
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const mkHandler = () => new WebtermRuntimeHandler({
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
      sessionStorePath: storePath,
      resumeFileCheck: () => true,
      directSpawnCommand: ["/usr/local/bin/claude", "--dangerously-skip-permissions"],
    });
    let handler = mkHandler();
    const t1 = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "hi", slack: slack.client });
    const sid1 = await driveBoot(mock);
    await finishTurn(mock, sid1, "hi", "hello!");
    await t1;
    const create1 = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/api/sessions"));
    const idFlag = create1!.body.command.indexOf("--session-id");
    expect(idFlag).toBeGreaterThan(-1);
    const uuid = create1!.body.command[idFlag + 1];
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    await handler.shutdown({ killSessions: true });

    // Simulate reap: webterm session is gone; a NEW handler (or the reaper)
    // must boot the thread's next session with --resume <same uuid>.
    mock.sessions.clear();
    mock.calls.length = 0;
    handler = mkHandler();
    const t2 = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "again", slack: slack.client });
    const sid2 = await driveBoot(mock);
    await finishTurn(mock, sid2, "again", "welcome back!");
    await t2;
    const create2 = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/api/sessions"));
    const resumeFlag = create2!.body.command.indexOf("--resume");
    expect(resumeFlag).toBeGreaterThan(-1);
    expect(create2!.body.command[resumeFlag + 1]).toBe(uuid);
    // No "fresh session" notice — this is the seamless path.
    expect(slack.posted.some((m) => m.text.includes("fresh session"))).toBe(false);
    await handler.shutdown({ killSessions: true });
  }, 10_000);

  it("expired conversation (no session file) boots fresh and says so", async () => {
    const storePath = freshStorePath();
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const mkHandler = (check: boolean) => new WebtermRuntimeHandler({
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
      sessionStorePath: storePath,
      resumeFileCheck: () => check,
      directSpawnCommand: ["/usr/local/bin/claude"],
    });
    let handler = mkHandler(true);
    const t1 = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "hi", slack: slack.client });
    const sid1 = await driveBoot(mock);
    await finishTurn(mock, sid1, "hi", "hello!");
    await t1;
    await handler.shutdown({ killSessions: true });

    mock.sessions.clear();
    mock.calls.length = 0;
    handler = mkHandler(false); // session file no longer exists
    const t2 = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "again", slack: slack.client });
    const sid2 = await driveBoot(mock);
    await finishTurn(mock, sid2, "again", "starting over.");
    await t2;
    expect(slack.posted.some((m) => m.text.includes("the earlier conversation expired"))).toBe(true);
    await handler.shutdown({ killSessions: true });
  }, 10_000);

  it("concurrent turns racing a pending bootNotice do not interleave PTY pastes (claw-uu2u A2)", async () => {
    const storePath = freshStorePath();
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const mkHandler = (check: boolean) => new WebtermRuntimeHandler({
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
      sessionStorePath: storePath,
      resumeFileCheck: () => check,
      directSpawnCommand: ["/usr/local/bin/claude"],
    });
    // First process seeds the store with a "prior" claude session uuid.
    let handler = mkHandler(true);
    const t1 = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "hi", slack: slack.client });
    const sid1 = await driveBoot(mock);
    await finishTurn(mock, sid1, "hi", "hello!");
    await t1;
    await handler.shutdown({ killSessions: true });

    mock.sessions.clear();
    mock.calls.length = 0;
    // Second process: the session file is gone (bot restarted, thread's
    // earlier conversation expired) — createSession sets bootNotice on the
    // ONE session both callers share via creationInFlight de-dup, and two
    // messages race in before either can claim inFlight (claw-uu2u A2).
    handler = mkHandler(false);
    const reqA = { channelId: "C1", threadTs: "1.0", text: "turn A", slack: slack.client };
    const reqB = { channelId: "C1", threadTs: "1.0", text: "turn B", slack: slack.client };
    const pA = handler.handleMessage(reqA);
    const pB = handler.handleMessage(reqB);
    const sid2 = await driveBoot(mock);

    // Whichever of A/B claims first, its paste lands — but the SECOND paste
    // must not land until the first turn's reply has been delivered. A
    // buggy build lets both slip through the claim window together (the
    // bootNotice postReply await sits between the inFlight check and claim).
    await waitFor(() => mock.sessions.get(sid2)!.inputs.some((i) => i.kind === "paste"));
    await sleep(30); // room for a buggy build to let the second paste slip in
    expect(mock.sessions.get(sid2)!.inputs.filter((i) => i.kind === "paste")).toHaveLength(1);

    const firstText = mock.sessions.get(sid2)!.inputs.find((i) => i.kind === "paste")!.data as string;
    await finishTurn(mock, sid2, firstText, "reply one");
    await waitFor(() => slack.posted.some((m) => m.text.includes("reply one")));

    // Only now should the second turn's paste land.
    await waitFor(() => mock.sessions.get(sid2)!.inputs.filter((i) => i.kind === "paste").length === 2);
    const secondText = mock.sessions.get(sid2)!.inputs.filter((i) => i.kind === "paste")[1].data as string;
    await finishTurn(mock, sid2, secondText, "reply two");

    await Promise.all([pA, pB]);
    const pastes = mock.sessions.get(sid2)!.inputs.filter((i) => i.kind === "paste").map((i) => i.data);
    expect(pastes).toEqual(["turn A", "turn B"]);
    // Only ONE bootNotice — not one per racing claimant.
    expect(slack.posted.filter((m) => m.text.includes("the earlier conversation expired"))).toHaveLength(1);
    await handler.shutdown({ killSessions: true });
  }, 10_000);

  it("a failed resume boot falls back to a fresh session with a notice", async () => {
    const storePath = freshStorePath();
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const mkHandler = () => new WebtermRuntimeHandler({
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
      sessionStorePath: storePath,
      resumeFileCheck: () => true,
      bootTimeoutMs: 300,
      directSpawnCommand: ["/usr/local/bin/claude"],
    });
    let handler = mkHandler();
    const t1 = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "hi", slack: slack.client });
    const sid1 = await driveBoot(mock);
    await finishTurn(mock, sid1, "hi", "hello!");
    await t1;
    await handler.shutdown({ killSessions: true });

    mock.sessions.clear();
    mock.calls.length = 0;
    handler = mkHandler();
    const t2 = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "again", slack: slack.client });
    // FIRST boot attempt (--resume) gets NO prompt-ready → times out at 300ms →
    // it is killed (DELETEd) and the fallback boots a SECOND session; wait on
    // the second POST, then drive the surviving session.
    const createCount = () => mock.calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/sessions")).length;
    await waitFor(() => createCount() === 2 && mock.sessions.size === 1, 5_000);
    const sid2 = [...mock.sessions.keys()].pop()!;
    await waitFor(() => mock.sessions.get(sid2)!.sseController !== null);
    mock.setText(sid2, buildBootGrid());
    mock.emitPromptReady(sid2);
    await waitFor(() => mock.sessions.get(sid2)!.inputs.some((i) => i.kind === "paste"));
    await finishTurn(mock, sid2, "again", "fresh start.");
    await t2;
    const creates = mock.calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/sessions"));
    expect(creates[0].body.command).toContain("--resume");
    expect(creates[1].body.command).toContain("--session-id");
    expect(slack.posted.some((m) => m.text.includes("couldn't resume the earlier conversation"))).toBe(true);
    await handler.shutdown({ killSessions: true });
  }, 15_000);

  it("a failed session POST during resume rethrows without touching the thread→session mapping (claw-uu2u A6)", async () => {
    const storePath = freshStorePath();
    const mock = makeMockWebterm();
    const slack = makeSlack();
    let createAttempts = 0;
    const mkHandler = (failCreate: boolean) => {
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = typeof input === "string" ? input : (input as URL).toString();
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "POST" && url.endsWith("/api/sessions")) createAttempts++;
        if (failCreate && method === "POST" && url.endsWith("/api/sessions")) {
          return new Response("webterm unavailable", { status: 500 });
        }
        return mock.fetchImpl(input, init);
      };
      return new WebtermRuntimeHandler({
        webtermUrl: "http://test.local", fetchImpl, cwd: "/tmp/t",
        pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
        turnEndQuietMs: 150, tripwireDelayMs: 10,
        sessionStorePath: storePath,
        resumeFileCheck: () => true,
        directSpawnCommand: ["/usr/local/bin/claude"],
      });
    };
    // First process seeds the store with a "prior" claude session uuid.
    let handler = mkHandler(false);
    const t1 = handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "hi", slack: slack.client });
    const sid1 = await driveBoot(mock);
    await finishTurn(mock, sid1, "hi", "hello!");
    await t1;
    await handler.shutdown({ killSessions: true });
    const uuidBefore = new ThreadSessionStore(storePath).get("C1::1.0");
    expect(uuidBefore).toBeDefined();

    mock.sessions.clear();
    mock.calls.length = 0;
    createAttempts = 0;
    // Second process: the resume attempt's session POST fails outright (a
    // webterm outage) — bootSession's own "createSession <status>" throw is
    // NOT resume-attributable, so it must rethrow rather than fall back to a
    // fresh session, and the store must stay untouched (claw-uu2u A6): a
    // transient webterm outage must not permanently overwrite the mapping.
    handler = mkHandler(true);
    await handler.handleMessage({ channelId: "C1", threadTs: "1.0", text: "again", slack: slack.client });

    expect(slack.posted.some((m) => m.text.includes("webterm session creation failed"))).toBe(true);
    expect(slack.posted.some((m) => m.text.includes("fresh session"))).toBe(false);
    const uuidAfter = new ThreadSessionStore(storePath).get("C1::1.0");
    expect(uuidAfter).toBe(uuidBefore);
    // No fresh-session fallback boot was attempted — exactly the one failed POST.
    expect(createAttempts).toBe(1);
    await handler.shutdown({ killSessions: true });
  }, 10_000);
});

describe("images out (claw-ynzo)", () => {
  it("uploads fresh produced files mentioned in the answer; skips nonexistent paths", async () => {
    const { writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(joinPath(tmpdir(), "imgout-"));
    const realPng = joinPath(dir, "chart.png");
    writeFileSync(realPng, "png-bytes");
    const uploaded: string[][] = [];
    const mock = makeMockWebterm();
    const slack = makeSlack();
    const handler = new WebtermRuntimeHandler({
      webtermUrl: "http://test.local", fetchImpl: mock.fetchImpl, cwd: "/tmp/t",
      pasteSettleMs: 5, extractStableMs: 10, turnPollMs: 20, reapIntervalMs: 0,
      turnEndQuietMs: 150, tripwireDelayMs: 10,
      sessionStorePath: freshStorePath(), resumeFileCheck: () => false,
    });
    const turn = handler.handleMessage({
      channelId: "C1", threadTs: "1.0", text: "make a chart", slack: slack.client,
      uploadFiles: async (paths) => { uploaded.push(paths); },
    });
    await waitFor(() => mock.sessions.size === 1 && [...mock.sessions.values()][0].sseController !== null);
    const sid = mock.onlySessionId();
    mock.setText(sid, buildBootGrid());
    mock.emitPromptReady(sid);
    await waitFor(() => mock.sessions.get(sid)!.inputs.some((i) => i.kind === "paste"));
    mock.setText(sid, buildTurnGrid("make a chart", `saved to ${realPng} and /no/such/file.png`));
    mock.emitOutputChunk(sid);
    await turn;
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toEqual([realPng]);
    await handler.shutdown({ killSessions: true });
  }, 10_000);
});
