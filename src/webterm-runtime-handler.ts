// Routes Slack messages from configured channels through a persistent
// interactive `claude` process hosted in webterm, instead of the
// `claude -p` SDK path.
//
// Why: the SDK path reinitializes MCP, permissions, and conversation
// context on every message. The webterm path keeps a long-lived claude
// REPL per Slack thread, so MCP stays warm and the conversation flows.
//
// Status: this is the **demoable** integration. One bot, one process, in-memory
// thread→session mapping (lost on restart). Production hardening is tracked
// under claw-usdo (persistence), claw-o05f (perm UX), claw-0dlt (staging
// app), claw-g790 (trust dialog).

import type { WebClient } from "@slack/web-api";
import { Logger } from "./logger";
import { extractTurn, formatTurnForSlack } from "./webterm-claude-extractor";

const DEFAULT_WEBTERM_URL = "http://127.0.0.1:7681";
const DEFAULT_CLAUDE_CMD = "claude --dangerously-skip-permissions";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
const DEFAULT_IDLE_MS = 1500;
const DEFAULT_PROMPT_POLL_MS = 400;
const DEFAULT_PROMPT_STABLE_POLLS = 3;
const BOOT_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = 180_000;
// Compensating control for claw-etj7: extractor returns null on no-⏺-block
// (premature prompt-ready). Retry up to N times before giving up.
const FALSE_POSITIVE_MAX_RETRIES = 3;

export interface WebtermRuntimeOpts {
  webtermUrl?: string;
  claudeCmd?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  fetchImpl?: typeof fetch;
}

interface WebtermSession {
  id: string;
  threadKey: string;
  promptReadyCount: number;
  sseAbort: AbortController;
  ssePromise: Promise<void>;
  alive: boolean;
  // Serializes turns per session — bot's thread-lock already enforces this
  // at the Slack level, but we mirror it locally as a safety net.
  inFlight: Promise<void> | null;
}

export interface HandleMessageOpts {
  channelId: string;
  threadTs: string | undefined;
  text: string;
  slack: Pick<WebClient, "chat">;
}

interface InternalOpts extends Required<Omit<WebtermRuntimeOpts, "fetchImpl">> {
  fetchImpl: typeof fetch;
}

export class WebtermRuntimeHandler {
  private sessions = new Map<string, WebtermSession>();
  // Two messages arriving on the same Slack thread within the createSession
  // window would both find the map empty and each create a webterm session.
  // The first POST wins but the second leaves an orphan. Track in-flight
  // creations here so concurrent callers await the same promise.
  private creationInFlight = new Map<string, Promise<WebtermSession>>();
  private logger = new Logger("WebtermRuntime");
  private opts: InternalOpts;

  constructor(opts: WebtermRuntimeOpts = {}) {
    this.opts = {
      webtermUrl: opts.webtermUrl ?? process.env.WEBTERM_URL ?? DEFAULT_WEBTERM_URL,
      claudeCmd: opts.claudeCmd ?? DEFAULT_CLAUDE_CMD,
      cwd: opts.cwd ?? `${process.env.HOME}/projects/claudeclaw`,
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      fetchImpl: opts.fetchImpl ?? fetch,
    };
  }

  threadKey(channelId: string, threadTs: string | undefined): string {
    return `${channelId}::${threadTs ?? "dm"}`;
  }

  async handleMessage(req: HandleMessageOpts): Promise<void> {
    const key = this.threadKey(req.channelId, req.threadTs);
    let session = this.sessions.get(key);
    if (session && !session.alive) {
      this.logger.info("Stale session, recreating", { threadKey: key });
      this.sessions.delete(key);
      session = undefined;
    }
    if (!session) {
      // De-dupe concurrent first-message creations for the same thread.
      let creation = this.creationInFlight.get(key);
      if (!creation) {
        creation = this.createSession(key)
          .then((s) => {
            this.sessions.set(key, s);
            return s;
          })
          .finally(() => {
            this.creationInFlight.delete(key);
          });
        this.creationInFlight.set(key, creation);
      }
      try {
        session = await creation;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error("Session creation failed", { threadKey: key, error: msg });
        await this.postReply(req, `:warning: webterm session creation failed: \`${msg}\``);
        return;
      }
    }

    // Serialize turns per session — the second message has to wait for the
    // first to complete its prompt-ready cycle.
    while (session.inFlight) {
      try { await session.inFlight; } catch { /* prior turn errored — fall through */ }
    }

    const turnPromise = this.takeTurn(session, req);
    session.inFlight = turnPromise.then(() => {}, () => {});
    try {
      await turnPromise;
    } finally {
      session.inFlight = null;
    }
  }

  private async takeTurn(session: WebtermSession, req: HandleMessageOpts): Promise<void> {
    let attempts = 0;
    let startCount = session.promptReadyCount;
    try {
      await this.sendInput(session.id, req.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error("sendInput failed", { sessionId: session.id, error: msg });
      await this.postReply(req, `:warning: failed to send input: \`${msg}\``);
      return;
    }

    while (attempts < FALSE_POSITIVE_MAX_RETRIES) {
      attempts++;
      try {
        await this.waitForPromptReady(session, startCount + attempts, TURN_TIMEOUT_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error("prompt-ready wait failed", { sessionId: session.id, attempts, error: msg });
        await this.postReply(req, `:warning: turn timed out: \`${msg}\``);
        return;
      }

      const grid = await this.fetchGridText(session.id);
      const turn = extractTurn(grid, req.text);
      // Both "null" (no user echo found) and "empty assistant block" can mean
      // the same thing: claude hasn't actually responded yet — prompt-ready
      // fired prematurely (claw-etj7). Treat both as retryable.
      const haveContent =
        turn !== null && (turn.assistant.trim().length > 0 || turn.toolNotes.length > 0);
      if (haveContent) {
        const slackText = formatTurnForSlack(turn!);
        await this.postReply(req, slackText);
        return;
      }
      this.logger.warn("Empty extraction (claw-etj7 false-positive?), retrying", {
        sessionId: session.id,
        attempt: attempts,
        turnIsNull: turn === null,
      });
    }

    this.logger.error("Exhausted false-positive retries", { sessionId: session.id, attempts });
    await this.postReply(req, ":warning: claude did not produce a response after multiple retries.");
  }

  private async createSession(threadKey: string): Promise<WebtermSession> {
    const res = await this.opts.fetchImpl(`${this.opts.webtermUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: `slack-bot ${threadKey}`,
        cols: this.opts.cols,
        rows: this.opts.rows,
        cwd: this.opts.cwd,
      }),
    });
    if (!res.ok) throw new Error(`createSession ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    const sseAbort = new AbortController();
    const session: WebtermSession = {
      id: body.id,
      threadKey,
      promptReadyCount: 0,
      sseAbort,
      ssePromise: Promise.resolve(),
      alive: true,
      inFlight: null,
    };
    session.ssePromise = this.runSseListener(session);
    // Boot claude inside the session.
    await this.sendInput(session.id, this.opts.claudeCmd);
    try {
      await this.waitForPromptReady(session, 1, BOOT_TIMEOUT_MS);
    } catch (err) {
      sseAbort.abort();
      await this.killWebtermSession(session.id).catch(() => {});
      throw err;
    }
    this.logger.info("Webterm session ready", { sessionId: session.id, threadKey });
    return session;
  }

  private async runSseListener(session: WebtermSession): Promise<void> {
    const url =
      `${this.opts.webtermUrl}/api/sessions/${session.id}/events` +
      `?idleMs=${DEFAULT_IDLE_MS}` +
      `&promptReady=true` +
      `&promptReadyPollMs=${DEFAULT_PROMPT_POLL_MS}` +
      `&promptReadyStablePolls=${DEFAULT_PROMPT_STABLE_POLLS}`;
    try {
      const res = await this.opts.fetchImpl(url, {
        headers: { accept: "text/event-stream" },
        signal: session.sseAbort.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE subscribe failed: ${res.status}`);
      }
      const decoder = new TextDecoder();
      let buf = "";
      for await (const chunk of res.body as any) {
        if (session.sseAbort.signal.aborted) break;
        buf += decoder.decode(chunk as Uint8Array, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const record = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = "";
          for (const line of record.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
          }
          if (event === "prompt-ready") session.promptReadyCount++;
          else if (event === "exit") {
            session.alive = false;
            this.logger.info("Webterm session exited", { sessionId: session.id });
            return;
          }
        }
      }
    } catch (err) {
      if (session.sseAbort.signal.aborted) return;
      session.alive = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error("SSE listener failed", { sessionId: session.id, error: msg });
    }
  }

  private async sendInput(sessionId: string, text: string): Promise<void> {
    const base = `${this.opts.webtermUrl}/api/sessions/${sessionId}/input`;
    const txt = await this.opts.fetchImpl(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "text", data: text }),
    });
    if (!txt.ok && txt.status !== 204) throw new Error(`sendInput text ${txt.status}`);
    const enter = await this.opts.fetchImpl(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "keys", keys: ["Enter"] }),
    });
    if (!enter.ok && enter.status !== 204) throw new Error(`sendInput enter ${enter.status}`);
  }

  private async fetchGridText(sessionId: string): Promise<string> {
    const res = await this.opts.fetchImpl(`${this.opts.webtermUrl}/api/sessions/${sessionId}/text`);
    if (!res.ok) throw new Error(`fetchGridText ${res.status}`);
    return await res.text();
  }

  private async killWebtermSession(sessionId: string): Promise<void> {
    await this.opts.fetchImpl(`${this.opts.webtermUrl}/api/sessions/${sessionId}`, { method: "DELETE" });
  }

  private async waitForPromptReady(
    session: WebtermSession,
    targetCount: number,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!session.alive) throw new Error("session died while waiting for prompt-ready");
      if (session.promptReadyCount >= targetCount) return;
      await sleep(50);
    }
    throw new Error(`prompt-ready ${targetCount} not seen within ${timeoutMs}ms`);
  }

  private async postReply(req: HandleMessageOpts, text: string): Promise<void> {
    // Slack post is best-effort — if it fails we log and move on.
    try {
      await req.slack.chat.postMessage({
        channel: req.channelId,
        thread_ts: req.threadTs,
        text,
        mrkdwn: true,
      });
    } catch (err) {
      this.logger.error("postMessage failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async shutdown(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      session.sseAbort.abort();
      tasks.push(this.killWebtermSession(session.id).catch(() => {}));
    }
    this.sessions.clear();
    await Promise.all(tasks);
  }

  // Test-only inspection — count live sessions.
  _sessionCount(): number {
    return this.sessions.size;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
