// Routes Slack messages from configured channels through a persistent
// interactive `claude` process hosted in webterm, instead of the
// `claude -p` SDK path.
//
// Why: the SDK path reinitializes MCP, permissions, and conversation
// context on every message. The webterm path keeps a long-lived claude
// REPL per Slack thread, so MCP stays warm and the conversation flows.
//
// Persistence (claw-usdo): the session TITLE carries the threadKey
// ("slack-bot <channel>::<thread>"), so webterm itself is the durable
// thread→session map. On a map miss the handler first tries to ADOPT a
// surviving session by title (verifying claude still runs inside) before
// creating one, and shutdown() leaves sessions alive by default so a bot
// restart resumes conversations. Remaining hardening: claw-o05f (perm UX),
// claw-0dlt (staging app), claw-g790 (trust dialog).

import type { WebClient } from "@slack/web-api";
import { Logger } from "./logger";
import { extractTurn, formatTurnForSlack, type ExtractedTurn } from "./webterm-claude-extractor";

const DEFAULT_WEBTERM_URL = "http://127.0.0.1:7681";
const DEFAULT_CLAUDE_CMD = "claude --dangerously-skip-permissions";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
const DEFAULT_IDLE_MS = 1500;
const DEFAULT_PROMPT_POLL_MS = 400;
const DEFAULT_PROMPT_STABLE_POLLS = 3;
// claude's TUI aggregates input arriving right after a bracketed paste into
// the paste itself — an Enter sent immediately is swallowed as a pasted
// newline and the message never submits. Verified empirically 2026-06-11 on
// v2.1.173: immediate Enter never submits, 600ms+ always does. 1s for margin.
const DEFAULT_PASTE_SETTLE_MS = 1_000;
// Fable-era models pause >1.2s mid-render, so prompt-ready can fire while the
// response is still streaming (observed live 2026-06-11: a 3-part answer
// posted with only part 1). After a non-empty extraction, keep re-extracting
// until two consecutive snapshots match before posting.
const DEFAULT_EXTRACT_STABLE_MS = 1_500;
const RENDER_SETTLE_DEADLINE_MS = 120_000;
// Sessions persist across restarts now (title adoption), so nothing else
// cleans them up — reap slack-bot sessions silent past the idle threshold.
// The conversation is lost but the next message recreates the session;
// acceptable until `--resume` lands.
const DEFAULT_IDLE_REAP_MS = 30 * 60_000;
const DEFAULT_REAP_INTERVAL_MS = 5 * 60_000;
const BOOT_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = 180_000;
// claude's first-run "trust this folder" dialog (claw-g790). It blocks the
// REPL, --dangerously-skip-permissions does NOT bypass it, and it's
// grid-stable so prompt-ready fires ON it. Detected at boot and accepted
// (option 1 is pre-selected; Enter confirms). Text captured live v2.1.173.
const TRUST_DIALOG_RE = /Is this a project you created or one you trust|Yes, I trust this folder/;
// Compensating control for claw-etj7: extractor returns null on no-⏺-block
// (premature prompt-ready). Retry up to N times before giving up.
const FALSE_POSITIVE_MAX_RETRIES = 3;

export interface WebtermRuntimeOpts {
  webtermUrl?: string;
  claudeCmd?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  pasteSettleMs?: number;
  extractStableMs?: number;
  idleReapMs?: number;
  // 0 disables the timer (tests drive reapIdleSessions() directly).
  reapIntervalMs?: number;
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
  // Per-thread working directory (from WorkingDirectoryManager); falls back
  // to the handler-level default cwd.
  cwd?: string;
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
  private reapTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: WebtermRuntimeOpts = {}) {
    this.opts = {
      webtermUrl: opts.webtermUrl ?? process.env.WEBTERM_URL ?? DEFAULT_WEBTERM_URL,
      claudeCmd: opts.claudeCmd ?? DEFAULT_CLAUDE_CMD,
      cwd: opts.cwd ?? `${process.env.HOME}/projects/claudeclaw`,
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      pasteSettleMs: opts.pasteSettleMs ?? DEFAULT_PASTE_SETTLE_MS,
      extractStableMs: opts.extractStableMs ?? DEFAULT_EXTRACT_STABLE_MS,
      idleReapMs: opts.idleReapMs ?? DEFAULT_IDLE_REAP_MS,
      reapIntervalMs: opts.reapIntervalMs ?? DEFAULT_REAP_INTERVAL_MS,
      fetchImpl: opts.fetchImpl ?? fetch,
    };
    if (this.opts.reapIntervalMs > 0) {
      this.reapTimer = setInterval(() => {
        void this.reapIdleSessions().catch((err) => {
          this.logger.error("Idle reap sweep failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, this.opts.reapIntervalMs);
      this.reapTimer.unref?.();
    }
  }

  threadKey(channelId: string, threadTs: string | undefined): string {
    return `${channelId}::${threadTs ?? "dm"}`;
  }

  async handleMessage(rawReq: HandleMessageOpts): Promise<void> {
    // Slack escapes & < > in message text; pasting them raw corrupts code
    // (observed live: `=>` arrived in claude's input as `=&gt;`).
    const req: HandleMessageOpts = { ...rawReq, text: decodeSlackEntities(rawReq.text) };
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
        creation = this.adoptOrCreateSession(key, req.channelId, req.threadTs, req.cwd)
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
      // Bracketed paste so newlines in multi-line Slack messages insert
      // literally instead of acting as Enter and submitting prematurely.
      await this.sendInput(session.id, req.text, {
        kind: "paste",
        settleMs: this.opts.pasteSettleMs,
      });
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
        const settled = await this.awaitRenderSettled(session, req.text, turn!);
        const slackText = formatTurnForSlack(settled);
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

  // Re-extract until two consecutive snapshots match (the response stopped
  // growing), bounded by RENDER_SETTLE_DEADLINE_MS. Best-effort: on webterm
  // errors or a vanished echo, post the last good extraction.
  private async awaitRenderSettled(
    session: WebtermSession,
    userText: string,
    last: ExtractedTurn,
  ): Promise<ExtractedTurn> {
    const deadline = Date.now() + RENDER_SETTLE_DEADLINE_MS;
    let prev = JSON.stringify([last.assistant, last.toolNotes]);
    while (Date.now() < deadline && session.alive) {
      await sleep(this.opts.extractStableMs);
      let turn: ExtractedTurn | null = null;
      try {
        const grid = await this.fetchGridText(session.id);
        turn = extractTurn(grid, userText);
      } catch {
        break;
      }
      if (!turn) break;
      const cur = JSON.stringify([turn.assistant, turn.toolNotes]);
      last = turn;
      if (cur === prev) return last;
      this.logger.info("Render still settling, re-polling", { sessionId: session.id });
      prev = cur;
    }
    return last;
  }

  // Wait for the boot prompt-ready, but verify the grid is actually the
  // claude prompt — the trust-folder dialog is grid-stable too, and typing
  // a user message into it was claw-akpn's lost-turn bug. Accept dialogs
  // (Enter confirms the pre-selected "Yes, I trust this folder") until the
  // real prompt appears or the boot deadline passes.
  private async completeBootHandshake(session: WebtermSession): Promise<void> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let target = 1;
    for (;;) {
      await this.waitForPromptReady(session, target, Math.max(1, deadline - Date.now()));
      const grid = await this.fetchGridText(session.id);
      if (!TRUST_DIALOG_RE.test(grid)) return;
      this.logger.info("Trust-folder dialog at boot — accepting", { sessionId: session.id });
      await this.sendKeys(session.id, ["Enter"]);
      target = session.promptReadyCount + 1;
    }
  }

  // Channel context restores what the SDK path provided via appendSystemPrompt:
  // claude inside the REPL knows which channel it's serving and can pick up
  // channel-specific protocols from CLAUDE.md (e.g. #cc-ai discourse mode).
  private buildBootCmd(channelId: string, threadTs: string | undefined): string {
    const ctx =
      `You are responding in Slack channel ID: ${channelId}` +
      (threadTs ? ` (thread: ${threadTs})` : "") +
      `. Check CLAUDE.md for any channel-specific protocols (e.g., #cc-ai Discourse Protocol). ` +
      `Format responses for Slack: plain prose, minimal markdown, no wide tables.`;
    return `${this.opts.claudeCmd} --append-system-prompt ${shellSingleQuote(ctx)}`;
  }

  private async adoptOrCreateSession(
    threadKey: string,
    channelId: string,
    threadTs: string | undefined,
    cwd?: string,
  ): Promise<WebtermSession> {
    const adopted = await this.tryAdoptSession(threadKey);
    if (adopted) return adopted;
    return this.createSession(threadKey, channelId, threadTs, cwd);
  }

  // Sweep ALL slack-bot-titled sessions in webterm (not just mapped ones, so
  // orphans from dead threads get cleaned too). Returns the reap count.
  async reapIdleSessions(): Promise<number> {
    let list: { id: string; title?: string; alive?: boolean; lastActivityAt?: number }[];
    const res = await this.opts.fetchImpl(`${this.opts.webtermUrl}/api/sessions`);
    if (!res.ok) throw new Error(`reap: list sessions ${res.status}`);
    list = (await res.json()) as typeof list;
    const cutoff = Date.now() - this.opts.idleReapMs;
    let reaped = 0;
    for (const s of list) {
      if (!s.title?.startsWith("slack-bot ")) continue;
      if ((s.lastActivityAt ?? Date.now()) > cutoff) continue;
      const threadKey = s.title.slice("slack-bot ".length);
      const local = this.sessions.get(threadKey);
      if (local?.inFlight) continue; // never reap mid-turn
      if (local) {
        local.sseAbort.abort();
        this.sessions.delete(threadKey);
      }
      await this.killWebtermSession(s.id).catch(() => {});
      this.logger.info("Reaped idle webterm session", {
        sessionId: s.id,
        threadKey,
        idleMs: Date.now() - (s.lastActivityAt ?? 0),
      });
      reaped++;
    }
    return reaped;
  }

  // A surviving session from a previous bot process carries the conversation —
  // adopt it by title. Guard: if claude exited inside the PTY, the session is
  // a bare shell and pasting a user message would EXECUTE it as a command;
  // detect via the model status row and recreate instead.
  private async tryAdoptSession(threadKey: string): Promise<WebtermSession | null> {
    let list: { id: string; title?: string; alive?: boolean }[];
    try {
      const res = await this.opts.fetchImpl(`${this.opts.webtermUrl}/api/sessions`);
      if (!res.ok) return null;
      list = (await res.json()) as typeof list;
    } catch {
      return null;
    }
    const match = list.find((s) => s.alive !== false && s.title === `slack-bot ${threadKey}`);
    if (!match) return null;
    try {
      const grid = await this.fetchGridText(match.id);
      if (!/(Opus|Fable|Sonnet|Haiku)\s+\d/.test(grid)) {
        this.logger.warn("Surviving session has no claude running — killing it", {
          sessionId: match.id,
          threadKey,
        });
        await this.killWebtermSession(match.id).catch(() => {});
        return null;
      }
    } catch {
      return null;
    }
    const session: WebtermSession = {
      id: match.id,
      threadKey,
      promptReadyCount: 0,
      sseAbort: new AbortController(),
      ssePromise: Promise.resolve(),
      alive: true,
      inFlight: null,
    };
    session.ssePromise = this.runSseListener(session);
    this.logger.info("Adopted surviving webterm session", { sessionId: match.id, threadKey });
    return session;
  }

  private async createSession(
    threadKey: string,
    channelId: string,
    threadTs: string | undefined,
    cwd?: string,
  ): Promise<WebtermSession> {
    const res = await this.opts.fetchImpl(`${this.opts.webtermUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: `slack-bot ${threadKey}`,
        cols: this.opts.cols,
        rows: this.opts.rows,
        cwd: cwd ?? this.opts.cwd,
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
    await this.sendInput(session.id, this.buildBootCmd(channelId, threadTs));
    try {
      await this.completeBootHandshake(session);
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

  private async sendInput(
    sessionId: string,
    text: string,
    opts: { kind?: "text" | "paste"; settleMs?: number } = {},
  ): Promise<void> {
    const base = `${this.opts.webtermUrl}/api/sessions/${sessionId}/input`;
    const txt = await this.opts.fetchImpl(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: opts.kind ?? "text", data: text }),
    });
    if (!txt.ok && txt.status !== 204) throw new Error(`sendInput text ${txt.status}`);
    // Wait out claude's paste-aggregation window before Enter, or the
    // submit keystroke is swallowed into the paste (see DEFAULT_PASTE_SETTLE_MS).
    if (opts.settleMs) await sleep(opts.settleMs);
    await this.sendKeys(sessionId, ["Enter"]);
  }

  private async sendKeys(sessionId: string, keys: string[]): Promise<void> {
    const res = await this.opts.fetchImpl(`${this.opts.webtermUrl}/api/sessions/${sessionId}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "keys", keys }),
    });
    if (!res.ok && res.status !== 204) throw new Error(`sendKeys ${res.status}`);
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

  // Default: leave webterm sessions ALIVE — they carry the conversations and
  // the next bot process adopts them by title (claw-usdo). killSessions: true
  // is for explicit decommissioning.
  async shutdown(opts: { killSessions?: boolean } = {}): Promise<void> {
    if (this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
    const tasks: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      session.sseAbort.abort();
      if (opts.killSessions) {
        tasks.push(this.killWebtermSession(session.id).catch(() => {}));
      }
    }
    this.sessions.clear();
    await Promise.all(tasks);
  }

  // Test-only inspection — count live sessions.
  _sessionCount(): number {
    return this.sessions.size;
  }
}

// POSIX single-quote escaping for command lines fed to a zsh PTY:
// close the quote, emit an escaped literal quote, reopen.
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// Slack mrkdwn escapes exactly three characters in message text. Decode
// &amp; last so double-encoded input stays literal. The transport suffix is
// stripped here too as a second line of defense — slack-handler strips it
// before command parsing, but this handler is also driven directly by tests
// and future surfaces.
export function decodeSlackEntities(s: string): string {
  return stripTransportSuffix(
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
  );
}

// "*Sent using* Claude" is appended by claude.ai-connected Slack clients.
// It's metadata, never user intent — claude visibly trips over it
// mid-conversation and it breaks cwd/mcp command parsing.
export function stripTransportSuffix(s: string): string {
  return s.replace(/\s*\*Sent using\* Claude\s*$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
