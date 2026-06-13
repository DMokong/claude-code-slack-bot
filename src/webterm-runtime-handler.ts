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
import { extractTurn, formatTurnForSlack, extractActivity, type ExtractedTurn } from "./webterm-claude-extractor";

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
// The model-status row claude's TUI always renders ("Fable 5 …", "Opus 4.8 …").
// Its presence means claude is the foreground process; its absence means the
// PTY fell back to a bare shell (claude exited) — see isRunningClaude (H1).
const CLAUDE_CHROME_RE = /(Opus|Fable|Sonnet|Haiku)\s+\d/;
// Compensating control for claw-etj7: extractor returns null on no-⏺-block
// (premature prompt-ready). Retry up to N times before giving up.
const FALSE_POSITIVE_MAX_RETRIES = 3;
// Live-activity status (claw-1ta5): the webterm path has no token stream, so to
// restore the SDK path's "working… / running a tool…" feedback we post a
// placeholder, update it with claude's live grid activity while the turn runs,
// then resolve the SAME message into the final answer.
const STATUS_PLACEHOLDER = "_🐾 on it…_";
const DEFAULT_STATUS_POLL_MS = 2_000;
// Floor between status updates — keeps us well under Slack's chat.update rate
// limit even on long tool-heavy turns.
const MIN_STATUS_UPDATE_MS = 1_500;

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
  // Bearer token for the webterm API (claw-yv02). When set, every API call
  // carries Authorization: Bearer <token>.
  token?: string;
  // Stream live-activity status to Slack during a turn (claw-1ta5). When on
  // AND the Slack client supports chat.update, the turn posts a placeholder,
  // updates it with claude's grid activity, and resolves it into the answer.
  // Default off so the simple post-final-message path (and its tests) are
  // unchanged; enabled in production via slack-handler.
  streamStatus?: boolean;
  statusPollMs?: number;
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
  // True only between boot/adoption (where the grid was already verified) and
  // the first turn — lets handleMessage skip a redundant liveness fetch (H1).
  freshlyBooted: boolean;
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

interface InternalOpts extends Required<Omit<WebtermRuntimeOpts, "fetchImpl" | "token">> {
  token: string;
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
  // fetchImpl with the bearer token injected (no-op when no token configured).
  private authedFetch: typeof fetch;

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
      token: opts.token ?? "",
      streamStatus: opts.streamStatus ?? false,
      statusPollMs: opts.statusPollMs ?? DEFAULT_STATUS_POLL_MS,
      fetchImpl: opts.fetchImpl ?? fetch,
    };
    const baseFetch = this.opts.fetchImpl;
    const token = this.opts.token;
    this.authedFetch = token
      ? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
          baseFetch(input, {
            ...init,
            headers: { ...(init?.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
          })) as typeof fetch
      : baseFetch;
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

    // Resolve a session that is (a) in the map, (b) alive, AND (c) actually
    // running claude — then re-verify after the inFlight wait (M2: the session
    // can die while we're queued) and before each turn (H1: claude can exit
    // inside the PTY, leaving a bare zsh that would EXECUTE the Slack message
    // as a shell command). Bounded retries guard against a flapping webterm.
    for (let attempt = 0; attempt < 3; attempt++) {
      let session: WebtermSession;
      try {
        session = await this.resolveSession(key, req);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error("Session creation failed", { threadKey: key, error: msg });
        await this.postReply(req, `:warning: webterm session creation failed: \`${msg}\``);
        return;
      }

      // Serialize turns per session — the second message waits for the first
      // to complete its prompt-ready cycle.
      while (session.inFlight) {
        try { await session.inFlight; } catch { /* prior turn errored — fall through */ }
      }

      // Re-validate: the queued wait above may have outlived the session, and
      // a freshly-booted session is known-good but a reused one may have lost
      // claude since its last turn.
      if (this.sessions.get(key) !== session || !session.alive) continue;
      if (!session.freshlyBooted && !(await this.isRunningClaude(session.id))) {
        this.logger.warn("Session no longer running claude — recreating", { sessionId: session.id, threadKey: key });
        session.sseAbort.abort();
        this.sessions.delete(key);
        await this.killWebtermSession(session.id).catch(() => {});
        continue;
      }
      session.freshlyBooted = false;

      const turnPromise = this.takeTurn(session, req);
      session.inFlight = turnPromise.then(() => {}, () => {});
      try {
        await turnPromise;
      } finally {
        session.inFlight = null;
      }
      return;
    }
    await this.postReply(req, ":warning: could not establish a stable claude session after several attempts.");
  }

  private async resolveSession(key: string, req: HandleMessageOpts): Promise<WebtermSession> {
    const existing = this.sessions.get(key);
    if (existing && existing.alive) return existing;
    if (existing) this.sessions.delete(key);
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
    return creation;
  }

  // Cheap liveness guard (H1): is claude actually the foreground process, or
  // did it exit and leave a bare shell? The model-status row is the tell.
  private async isRunningClaude(sessionId: string): Promise<boolean> {
    try {
      const grid = await this.fetchGridText(sessionId);
      return CLAUDE_CHROME_RE.test(grid);
    } catch {
      return false;
    }
  }

  private async takeTurn(session: WebtermSession, req: HandleMessageOpts): Promise<void> {
    // Live-activity status (claw-1ta5): post a placeholder we'll keep updating
    // with claude's progress, then resolve into the answer. If streaming is off
    // or the placeholder post fails, statusTs is undefined and we just post the
    // final message the old way.
    const statusTs = this.streamEnabled(req) ? await this.postStatusPlaceholder(req) : undefined;
    const statusCtl = { cancelled: false };
    const statusLoop = statusTs
      ? this.runStatusLoop(session, req, statusTs, statusCtl)
      : Promise.resolve();
    // Stop the status loop and DRAIN any in-flight update before delivering the
    // final text, so the answer is always the last write to the message.
    const stopStatus = async () => {
      statusCtl.cancelled = true;
      await statusLoop.catch(() => {});
    };
    const deliver = (text: string) => this.deliverReply(req, statusTs, text);

    let attempts = 0;
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
      await stopStatus();
      await deliver(`:warning: failed to send input: \`${msg}\``);
      return;
    }

    // Capture the baseline AFTER sendInput (M1): the paste re-arms the
    // rising-edge prompt-ready detector, so a count snapshotted before the
    // paste would treat that paste-induced fire as the turn's response and
    // burn a retry. The Enter we just sent guarantees a real post-turn fire.
    const startCount = session.promptReadyCount;

    while (attempts < FALSE_POSITIVE_MAX_RETRIES) {
      attempts++;
      try {
        await this.waitForPromptReady(session, startCount + attempts, TURN_TIMEOUT_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error("prompt-ready wait failed", { sessionId: session.id, attempts, error: msg });
        await stopStatus();
        await deliver(`:warning: turn timed out: \`${msg}\``);
        return;
      }

      let turn: ExtractedTurn | null;
      try {
        turn = await this.fetchAndExtract(session.id, req.text);
      } catch (err) {
        // M3: webterm can die between prompt-ready and the fetch. Without this
        // the error propagated past every warning path and the turn vanished.
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error("grid fetch failed mid-turn", { sessionId: session.id, error: msg });
        await stopStatus();
        await deliver(`:warning: lost the webterm session mid-turn: \`${msg}\``);
        return;
      }
      // Both "null" (no user echo found) and "empty assistant block" can mean
      // the same thing: claude hasn't actually responded yet — prompt-ready
      // fired prematurely (claw-etj7). Treat both as retryable.
      const haveContent =
        turn !== null && (turn.assistant.trim().length > 0 || turn.toolNotes.length > 0);
      if (haveContent) {
        const settled = await this.awaitRenderSettled(session, req.text, turn!);
        const slackText = formatTurnForSlack(settled);
        await stopStatus();
        await deliver(slackText);
        return;
      }
      this.logger.warn("Empty extraction (claw-etj7 false-positive?), retrying", {
        sessionId: session.id,
        attempt: attempts,
        turnIsNull: turn === null,
      });
    }

    this.logger.error("Exhausted false-positive retries", { sessionId: session.id, attempts });
    await stopStatus();
    await deliver(":warning: claude did not produce a response after multiple retries.");
  }

  private streamEnabled(req: HandleMessageOpts): boolean {
    return this.opts.streamStatus && typeof (req.slack.chat as { update?: unknown }).update === "function";
  }

  // Post the "_🐾 on it…_" placeholder; returns its ts, or undefined if the
  // post failed (in which case the turn falls back to a single final message).
  private async postStatusPlaceholder(req: HandleMessageOpts): Promise<string | undefined> {
    try {
      const res = (await req.slack.chat.postMessage({
        channel: req.channelId,
        thread_ts: req.threadTs,
        text: STATUS_PLACEHOLDER,
        mrkdwn: true,
      })) as { ts?: string };
      return typeof res?.ts === "string" ? res.ts : undefined;
    } catch (err) {
      this.logger.error("status placeholder post failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  // Poll the grid while the turn runs and chat.update the placeholder with
  // claude's current activity. Best-effort and deduped/throttled so a failed
  // update or a stable status never disrupts the turn.
  private async runStatusLoop(
    session: WebtermSession,
    req: HandleMessageOpts,
    statusTs: string,
    ctl: { cancelled: boolean },
  ): Promise<void> {
    let lastText = STATUS_PLACEHOLDER;
    let lastUpdate = 0;
    while (!ctl.cancelled && session.alive) {
      await sleep(this.opts.statusPollMs);
      if (ctl.cancelled || !session.alive) break;
      let grid: string;
      try {
        grid = await this.fetchGridText(session.id);
      } catch {
        continue;
      }
      const label = extractActivity(grid);
      if (!label) continue;
      const text = `_${label}_`;
      if (text === lastText) continue;
      if (Date.now() - lastUpdate < MIN_STATUS_UPDATE_MS) continue;
      lastText = text;
      lastUpdate = Date.now();
      if (ctl.cancelled) break;
      try {
        await req.slack.chat.update({ channel: req.channelId, ts: statusTs, text });
      } catch (err) {
        this.logger.warn("status update failed (best-effort)", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Deliver the final text: update the placeholder in place when we have one
  // (falling back to a fresh message if the update fails), else post fresh.
  private async deliverReply(req: HandleMessageOpts, statusTs: string | undefined, text: string): Promise<void> {
    if (statusTs) {
      try {
        await req.slack.chat.update({ channel: req.channelId, ts: statusTs, text });
        return;
      } catch (err) {
        this.logger.error("final chat.update failed — falling back to postMessage", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await this.postReply(req, text);
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
        turn = await this.fetchAndExtract(session.id, userText);
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
    const res = await this.authedFetch(`${this.opts.webtermUrl}/api/sessions`);
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
      const res = await this.authedFetch(`${this.opts.webtermUrl}/api/sessions`);
      if (!res.ok) return null;
      list = (await res.json()) as typeof list;
    } catch {
      return null;
    }
    const match = list.find((s) => s.alive !== false && s.title === `slack-bot ${threadKey}`);
    if (!match) return null;
    try {
      const grid = await this.fetchGridText(match.id);
      if (!CLAUDE_CHROME_RE.test(grid)) {
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
      freshlyBooted: true,
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
    const res = await this.authedFetch(`${this.opts.webtermUrl}/api/sessions`, {
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
      freshlyBooted: true,
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
      const res = await this.authedFetch(url, {
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
    const txt = await this.authedFetch(base, {
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
    const res = await this.authedFetch(`${this.opts.webtermUrl}/api/sessions/${sessionId}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "keys", keys }),
    });
    if (!res.ok && res.status !== 204) throw new Error(`sendKeys ${res.status}`);
  }

  private async fetchGridText(sessionId: string): Promise<string> {
    const res = await this.authedFetch(`${this.opts.webtermUrl}/api/sessions/${sessionId}/text`);
    if (!res.ok) throw new Error(`fetchGridText ${res.status}`);
    return await res.text();
  }

  // Fetch the rows that scrolled off the top of the viewport (claw-fcd9). The
  // xterm headless buffer keeps 1000 lines; from=-1000,to=0 grabs everything
  // above the current viewport top, contiguous with /text (to=0 ends exactly
  // where the viewport begins, so scrollback + "\n" + viewport has no overlap
  // and no gap). Best-effort: returns "" on any failure or empty history so the
  // caller falls back cleanly.
  private async fetchScrollback(sessionId: string): Promise<string> {
    try {
      const res = await this.authedFetch(
        `${this.opts.webtermUrl}/api/sessions/${sessionId}/scrollback?from=-1000&to=0`,
      );
      if (!res.ok) return "";
      const body = (await res.json()) as { lines?: string[] };
      return Array.isArray(body.lines) ? body.lines.join("\n") : "";
    } catch {
      return "";
    }
  }

  // Extract the turn from the session grid, recovering scrolled-off content
  // when needed (claw-fcd9). extractTurn(viewport) returning null means the
  // user echo isn't in the 40-row viewport — almost always a tall response
  // that pushed the echo off the top. We then prepend the scrollback (the rows
  // above the viewport) and re-extract from the full transcript. This
  // distinguishes "echo scrolled off (turn likely complete)" from
  // "echo present but assistant empty (genuine premature prompt-ready / etj7)":
  // the latter returns a non-null turn and never triggers the scrollback fetch,
  // so the caller's retry loop handles it without burning the 180s timeout.
  //
  // The primary viewport fetch can throw (webterm died mid-turn, M3) — that
  // propagates so the caller posts a warning. The scrollback fetch is
  // best-effort (swallowed); worst case we return null and the caller retries.
  private async fetchAndExtract(sessionId: string, userText: string): Promise<ExtractedTurn | null> {
    const viewport = await this.fetchGridText(sessionId);
    const turn = extractTurn(viewport, userText);
    if (turn !== null) return turn;
    const scrollback = await this.fetchScrollback(sessionId);
    if (!scrollback) return null;
    return extractTurn(scrollback + "\n" + viewport, userText);
  }

  private async killWebtermSession(sessionId: string): Promise<void> {
    await this.authedFetch(`${this.opts.webtermUrl}/api/sessions/${sessionId}`, { method: "DELETE" });
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
