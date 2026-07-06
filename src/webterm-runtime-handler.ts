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
import { extractTurn, extractSegments, isGridIdle, formatTurnForSlack, extractActivity, type Segment } from "./webterm-claude-extractor";

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
// The relay loop has no fixed turn cap (long agentic tasks stream for minutes).
// Instead it aborts only when the session looks WEDGED: the grid stopped
// changing, no active spinner, and claude is not idle at the prompt, for this
// long. A live tool run keeps a spinner up, so it never trips this (claw-gxzq).
const DEFAULT_SLIDING_INACTIVITY_MS = 5 * 60_000;
// Consecutive idle observations required before declaring the turn finished
// AND before finalizing the trailing prose block. The count resets whenever
// the grid changes, so "stable idle" means idle across this many polls with a
// frozen grid. Both guards exist because claude REMOVES the spinner line while
// it streams prose into the transcript (claw-gxzq, 200ms frame captures in
// test/fixtures/webterm-grids/08-*): a single idle-looking frame is routinely
// a mid-render pause with the trailing block at partial text.
const IDLE_STABLE_POLLS = 2;
// How often to re-extract the grid while waiting for the answer (claw-fcd9/etj7
// fix A). The turn loop polls on this interval AND wakes early on a prompt-ready
// fire — so a MISSING post-completion prompt-ready (the etj7 non-deterministic
// firing) can't strand the turn until the deadline; the next poll catches it.
const DEFAULT_TURN_POLL_MS = 1_500;
// On shutdown, how long to wait for in-flight turns to post their reply before
// tearing down (claw-wb4a). Slack acked the event already, so a dropped reply
// never redelivers — but we can't block launchd's SIGTERM forever either.
const SHUTDOWN_DRAIN_MS = 5_000;
// claude's first-run "trust this folder" dialog (claw-g790). It blocks the
// REPL, --dangerously-skip-permissions does NOT bypass it, and it's
// grid-stable so prompt-ready fires ON it. Detected at boot and accepted
// (option 1 is pre-selected; Enter confirms). Text captured live v2.1.173.
const TRUST_DIALOG_RE = /Is this a project you created or one you trust|Yes, I trust this folder/;
// The model-status row claude's TUI always renders ("Fable 5 …", "Opus 4.8 …").
// Its presence means claude is the foreground process; its absence means the
// PTY fell back to a bare shell (claude exited) — see isRunningClaude (H1).
const CLAUDE_CHROME_RE = /(Opus|Fable|Sonnet|Haiku)\s+\d/;
// Live-activity status (claw-1ta5): the webterm path has no token stream, so to
// restore the SDK path's "working… / running a tool…" feedback we post a
// placeholder, update it with claude's live grid activity while the turn runs,
// then resolve the SAME message into the final answer.
const STATUS_PLACEHOLDER = "_🐾 on it…_";
const DEFAULT_STATUS_POLL_MS = 2_000;
// Floor between status updates — keeps us well under Slack's chat.update rate
// limit even on long tool-heavy turns.
const MIN_STATUS_UPDATE_MS = 1_500;
const DEFAULT_IDLE_OUTPUT_FLOOR_MS = 250;

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
  // How often the turn loop re-extracts the grid while waiting for the answer
  // (claw-fcd9/etj7 fix A). Tests set this small for speed.
  turnPollMs?: number;
  // Sliding inactivity window for the relay loop (claw-gxzq): if the grid
  // doesn't change for this long and the session isn't idle, abort as wedged.
  slidingInactivityMs?: number;
  // Minimum ms since the PTY's last output before an idle-LOOKING frame may
  // count toward stable idle (claw-3btg.4). Claude removes its spinner while
  // still streaming prose; a frame fetched mid-paint reads as idle but the
  // server's x-webterm-last-output-ms header exposes the fresh output. Servers
  // without the header skip the floor (backward compatible).
  idleOutputFloorMs?: number;
  // Direct-spawn argv (claw-3btg.1): when non-empty, sessions are created with
  // webterm's command[] option so the PTY child IS claude — no wrapping shell
  // to fall through to when claude dies (H1 becomes structural). argv[0] must
  // be an absolute path on the webterm server's WEBTERM_SPAWN_ALLOWLIST.
  // Empty (default) = legacy mode: boot claude by typing claudeCmd into the
  // session's shell.
  directSpawnCommand?: string[];
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
      turnPollMs: opts.turnPollMs ?? DEFAULT_TURN_POLL_MS,
      slidingInactivityMs: opts.slidingInactivityMs ?? DEFAULT_SLIDING_INACTIVITY_MS,
      idleOutputFloorMs: opts.idleOutputFloorMs ?? DEFAULT_IDLE_OUTPUT_FLOOR_MS,
      directSpawnCommand: opts.directSpawnCommand ?? [],
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
    //
    // Continuous relay (claw-gxzq): keep watching the grid and post each new
    // settled prose block as it appears, until claude returns to a stable idle
    // prompt. No fixed cap — only a sliding inactivity guard for wedged sessions.
    // prompt-ready is an optimization (fast-path wake); the poll timer catches
    // turns where it never fires (claw-fcd9/etj7).
    let postedSegments = 0;            // prose blocks already committed (finalized/posted)
    let idleObservations = 0;
    let lastGrid = "";
    let lastChangeAt = Date.now();
    let lastBaseline = session.promptReadyCount;
    // Server-side mutation seq from the last /text fetch (claw-3btg.3): lets
    // the loop wake on GET /wait the moment the grid changes instead of
    // sleeping a full poll tick. -1 = not yet known.
    let lastSeq = -1;
    // Streaming cursor (claw-gxzq Task 3): the Slack ts of the prose block
    // currently growing in-place, and its segment index. statusTs seeds the
    // first block so it reuses the placeholder; growingIndex === -1 means the
    // placeholder is unbound (available for the first delivered block).
    let growingTs: string | undefined = statusTs;
    let growingIndex = -1;
    const streaming = this.streamEnabled(req);

    for (;;) {
      // While confirming idle, wait only the short settle window — a static
      // grid never fires /wait, so the confirming observation must come from
      // the timer, not the change signal (claw-3btg.3).
      const waitMs = idleObservations > 0
        ? Math.min(this.opts.turnPollMs, this.opts.extractStableMs)
        : this.opts.turnPollMs;
      await this.waitForTurnSignal(session, lastBaseline + 1, lastSeq, waitMs);
      lastBaseline = session.promptReadyCount;
      if (!session.alive) {
        await stopStatus();
        // Deliver whatever we have; warn only if nothing was posted. The
        // terminal-retained corpse tells us WHY it died (claw-3btg.2).
        if (postedSegments === 0) {
          const cause = await this.fetchExitCause(session.id);
          await deliver(`:warning: lost the webterm session mid-turn${cause ? ` — ${cause}` : ""}.`);
        }
        return;
      }

      let grid: string;
      let lastOutputMs = NaN;
      try {
        const meta = await this.fetchGridForRelay(session.id, req.text);
        grid = meta.grid;
        lastOutputMs = meta.lastOutputMs;
        if (Number.isFinite(meta.seq)) lastSeq = meta.seq;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error("grid fetch failed mid-turn", { sessionId: session.id, error: msg });
        await stopStatus();
        if (postedSegments === 0) await deliver(`:warning: lost the webterm session mid-turn: \`${msg}\``);
        return;
      }

      const gridChanged = grid !== lastGrid;
      if (gridChanged) { lastGrid = grid; lastChangeAt = Date.now(); }

      // Idle = idle-looking grid AND paint settled (claw-3btg.4): claude drops
      // its spinner while still streaming, so a frame with output younger than
      // the floor is a mid-paint pause, not the prompt. No header = no floor.
      const paintSettled = !Number.isFinite(lastOutputMs) || lastOutputMs >= this.opts.idleOutputFloorMs;
      const idle = isGridIdle(grid) && paintSettled;

      // Turn-end: idle prompt, stable across IDLE_STABLE_POLLS observations
      // with NO grid change in between — a changed grid restarts the count at
      // 1, because an idle-looking frame whose content is still moving is a
      // mid-render pause, not the prompt (claw-gxzq trailing-body drop).
      // Stop the status loop on the FIRST idle observation — BEFORE
      // relayNewSegments delivers any block — so a still-running status loop
      // can't overwrite the delivered answer during the second-observation wait.
      if (idle) {
        idleObservations = gridChanged ? 1 : idleObservations + 1;
        if (idleObservations === 1) await stopStatus();
      } else {
        idleObservations = 0;
      }
      const stableIdle = idle && idleObservations >= IDLE_STABLE_POLLS;

      // Post/grow NEW prose blocks. extractSegments filters tips/recap/spinner;
      // tool blocks advance the high-water mark only. Streaming grows the
      // trailing still-rendering block in place (Task 3); the trailing block
      // only FINALIZES on stable idle, on the same tick the turn ends.
      ({ postedSegments, growingTs, growingIndex } = await this.relayNewSegments(
        session, req, grid, deliver, stopStatus,
        { postedSegments, growingTs, growingIndex, streaming, stableIdle },
      ));

      if (stableIdle) {
        // stopStatus was called above at idleObservations === 1.
        if (postedSegments === 0) {
          // Idle but nothing extracted — fall back to the whole-turn extractor
          // (covers answers with no ⏺ prose, and keeps the warning behavior).
          const turn = extractTurn(grid, req.text);
          const text = turn ? formatTurnForSlack(turn) : "";
          await deliver(text || ":warning: claude did not produce a visible response.");
        }
        return;
      }

      // Wedged-session guard.
      if (
        !idle &&
        Date.now() - lastChangeAt > this.opts.slidingInactivityMs
      ) {
        this.logger.error("Turn wedged — no grid change within inactivity window", { sessionId: session.id });
        await stopStatus();
        if (postedSegments === 0) await deliver(":warning: claude stopped responding.");
        return;
      }
    }
  }

  // Resolve when promptReadyCount reaches `target` (fast path), the server
  // reports a grid change past `sinceSeq` (claw-3btg.3), the session dies, or
  // `ms` elapses (poll tick) — whichever is first. A timeout is NOT an error:
  // it just means "poll the grid now" (claw-fcd9/etj7 fix A). The server wait
  // is best-effort — a pre-/wait server just falls back to the deadline.
  private async waitForTurnSignal(
    session: WebtermSession,
    target: number,
    sinceSeq: number,
    ms: number,
  ): Promise<void> {
    const deadline = Date.now() + ms;
    const ctl = new AbortController();
    let serverWoke = false;
    const serverWait = this.authedFetch(
      `${this.opts.webtermUrl}/api/sessions/${session.id}/wait?since=${Math.max(0, sinceSeq)}&timeoutMs=${ms}`,
      { signal: ctl.signal },
    ).then(async (res) => {
      if (res.ok) {
        const body = (await res.json()) as { changed?: boolean };
        serverWoke = body.changed === true;
      }
    }).catch(() => { /* aborted or unsupported */ });
    try {
      for (;;) {
        if (!session.alive) return;
        if (session.promptReadyCount >= target) return;
        if (serverWoke) return;
        if (Date.now() >= deadline) return;
        await sleep(50);
      }
    } finally {
      ctl.abort();
      await serverWait;
    }
  }

  // "claude exited (code N)" from the terminal-retained session, or "" when
  // the server predates retention / the session is already evicted.
  private async fetchExitCause(sessionId: string): Promise<string> {
    try {
      const res = await this.authedFetch(`${this.opts.webtermUrl}/api/sessions`);
      if (!res.ok) return "";
      const list = (await res.json()) as { id: string; exitCode?: number | null }[];
      const s = list.find((x) => x.id === sessionId);
      if (!s || s.exitCode === undefined) return "";
      return `claude exited (code ${s.exitCode ?? "signal"})`;
    } catch {
      return "";
    }
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

  // Returns the relay transcript: viewport, or scrollback+viewport when the
  // user echo scrolled off the 40-row viewport (claw-fcd9): prepend scrollback
  // and return the TEXT so the caller can both extractSegments and isGridIdle
  // from one fetch.
  private async fetchGridForRelay(
    sessionId: string,
    userText: string,
  ): Promise<{ grid: string; seq: number; lastOutputMs: number }> {
    const meta = await this.fetchGridMeta(sessionId);
    if (extractSegments(meta.text, userText).length > 0) {
      return { grid: meta.text, seq: meta.seq, lastOutputMs: meta.lastOutputMs };
    }
    const scrollback = await this.fetchScrollback(sessionId);
    const grid = scrollback ? scrollback + "\n" + meta.text : meta.text;
    return { grid, seq: meta.seq, lastOutputMs: meta.lastOutputMs };
  }

  // Relay prose blocks that appeared since `postedSegments`. Tool blocks never
  // post (the status line shows tool activity); they still advance the
  // high-water mark so a later prose block isn't mis-indexed.
  //
  // Settle rule (claw-gxzq, rewritten after the trailing-body drop): a block is
  // settled when a LATER segment exists below it (claude renders sequentially),
  // or on STABLE idle — idle observed across IDLE_STABLE_POLLS polls with a
  // frozen grid, the same condition that ends the turn. Nothing weaker settles
  // the trailing block: captured frames (test/fixtures/webterm-grids/08-*/09-*)
  // show claude removes the spinner line while streaming prose, so "idle" on a
  // single frame — and the old "a spinner is up ⇒ prior blocks settled"
  // heuristic — both routinely finalize a block at partial text, and the
  // high-water mark makes that unrepairable.
  //
  // Discrete-post path (streamStatus off / no chat.update): each settled prose
  // block is its own message (Task 2) — the trailing block posts once, complete,
  // when the turn ends.
  //
  // Streaming path (Task 3): the first delivered prose block reuses the
  // placeholder (resolved in place); subsequent settled blocks open a fresh
  // message. The still-rendering trailing block GROWS in place via chat.update
  // so the user sees partial text live; it finalizes in the same message on
  // stable idle. The first relayed prose write also stops the status loop —
  // once delivered prose owns the placeholder, a still-running status loop
  // must not clobber it with a transient tool label.
  private async relayNewSegments(
    session: WebtermSession,
    req: HandleMessageOpts,
    grid: string,
    deliver: (text: string) => Promise<void>,
    stopStatus: () => Promise<void>,
    state: { postedSegments: number; growingTs: string | undefined; growingIndex: number; streaming: boolean; stableIdle: boolean },
  ): Promise<{ postedSegments: number; growingTs: string | undefined; growingIndex: number }> {
    let { postedSegments, growingTs, growingIndex } = state;
    const segments = extractSegments(grid, req.text);
    const settled = state.stableIdle ? segments.length : Math.max(0, segments.length - 1);

    if (!state.streaming) {
      for (let i = postedSegments; i < settled; i++) {
        if (segments[i].kind === "prose") await this.postReply(req, segments[i].text);
      }
      return { postedSegments: Math.max(postedSegments, settled), growingTs, growingIndex };
    }

    // Is the held-back trailing block a still-rendering prose block to grow?
    const trailingIdx = segments.length - 1;
    const trailingIsGrowingProse =
      !state.stableIdle &&
      trailingIdx >= postedSegments &&
      segments[trailingIdx]?.kind === "prose";

    // Decide up front whether we'll write any prose this tick; if so, stop the
    // status loop FIRST so it can't overwrite delivered prose in the shared
    // placeholder (the status-loop ↔ growing-message race).
    let willWriteProse = trailingIsGrowingProse;
    for (let i = postedSegments; i < settled && !willWriteProse; i++) {
      if (segments[i].kind === "prose") willWriteProse = true;
    }
    if (willWriteProse) await stopStatus();

    // 1) Finalize fully-settled prose blocks at/after the high-water mark.
    for (let i = postedSegments; i < settled; i++) {
      const seg = segments[i];
      if (seg.kind !== "prose") continue;
      if (i === growingIndex && growingTs) {
        // We were growing this block — finalize it in place with its final text.
        const ok = await this.updateStreamMessage(req, growingTs, seg.text);
        // Fix 4: if the final chat.update fails, don't silently lose the final
        // delta — post it fresh, mirroring deliverReply's fallback.
        if (!ok) await this.postReply(req, seg.text);
        growingTs = undefined;
        growingIndex = -1;
      } else if (growingTs && growingIndex === -1) {
        // First delivered block reuses the placeholder (resolve in place via
        // deliver, which has the postMessage fallback if chat.update fails).
        await deliver(seg.text);
        growingTs = undefined; // placeholder now holds answer content
      } else {
        await this.postFreshStreamMessage(req, seg.text);
      }
    }
    postedSegments = Math.max(postedSegments, settled);

    // 2) Grow the trailing still-rendering prose block, if any.
    if (trailingIsGrowingProse) {
      const text = segments[trailingIdx].text;
      if (growingIndex === trailingIdx) {
        // Already tracking this block. Update it if we have a ts; if the fresh
        // post below previously failed (no ts, e.g. a Slack outage) do NOT spam
        // a new message every tick — leave it to finalize via the finalize loop
        // once it settles (Fix 3).
        if (growingTs) await this.updateStreamMessage(req, growingTs, text);
      } else if (growingTs && growingIndex === -1) {
        // Bind the placeholder to this growing block.
        growingIndex = trailingIdx;
        await this.updateStreamMessage(req, growingTs, text);
      } else {
        // Open a fresh message for this growing block. Bind growingIndex even if
        // the post returned no ts, so the branch above suppresses re-posting on
        // subsequent ticks (Fix 3).
        growingTs = await this.postFreshStreamMessage(req, text);
        growingIndex = trailingIdx;
      }
    }

    return { postedSegments, growingTs, growingIndex };
  }

  // Post a brand-new streamed message and return its ts (best-effort; returns
  // undefined if the post failed or the client can't return a ts).
  private async postFreshStreamMessage(req: HandleMessageOpts, text: string): Promise<string | undefined> {
    try {
      const res = (await req.slack.chat.postMessage({
        channel: req.channelId,
        thread_ts: req.threadTs,
        text,
        mrkdwn: true,
      })) as { ts?: string };
      return typeof res?.ts === "string" ? res.ts : undefined;
    } catch (err) {
      this.logger.error("stream message post failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  // Grow an existing streamed message in place (best-effort chat.update; rides
  // the relay loop's turnPollMs cadence, already under Slack's edit rate limit).
  // Returns false if the update threw, so a finalize caller can fall back to a
  // fresh post rather than silently lose the final delta (Fix 4).
  private async updateStreamMessage(req: HandleMessageOpts, ts: string, text: string): Promise<boolean> {
    try {
      await req.slack.chat.update({ channel: req.channelId, ts, text });
      return true;
    } catch (err) {
      this.logger.warn("stream message update failed (best-effort)", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
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
  private buildBootCtx(channelId: string, threadTs: string | undefined): string {
    return (
      `You are responding in Slack channel ID: ${channelId}` +
      (threadTs ? ` (thread: ${threadTs})` : "") +
      `. Check CLAUDE.md for any channel-specific protocols (e.g., #cc-ai Discourse Protocol). ` +
      `Format responses for Slack: plain prose, minimal markdown, no wide tables.`
    );
  }

  private buildBootCmd(channelId: string, threadTs: string | undefined): string {
    return `${this.opts.claudeCmd} --append-system-prompt ${shellSingleQuote(this.buildBootCtx(channelId, threadTs))}`;
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
    const directSpawn = this.opts.directSpawnCommand.length > 0;
    const res = await this.authedFetch(`${this.opts.webtermUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: `slack-bot ${threadKey}`,
        cols: this.opts.cols,
        rows: this.opts.rows,
        cwd: cwd ?? this.opts.cwd,
        // Direct spawn: claude is the PTY child; context rides as a raw argv
        // element (no shell-quoting layer between us and claude).
        ...(directSpawn
          ? { command: [...this.opts.directSpawnCommand, "--append-system-prompt", this.buildBootCtx(channelId, threadTs)] }
          : {}),
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
    // Legacy shell mode: boot claude by typing the command into the shell.
    // Direct-spawn mode skips this — claude IS the PTY child and is already
    // booting when the POST returns.
    if (!directSpawn) await this.sendInput(session.id, this.buildBootCmd(channelId, threadTs));
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
    await this.checkInputResponse(txt, sessionId, "sendInput text");
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
    await this.checkInputResponse(res, sessionId, "sendKeys");
  }

  // Shared /input response handling: 409 = terminal-retained dead session
  // (claw-3btg.2) — surface the exit cause; 200 = echo ack (claw-3btg.8) —
  // echoed:false means the PTY swallowed the write silently, worth a warning
  // but not a failure (the turn loop's own guards decide what to do next).
  private async checkInputResponse(res: Response, sessionId: string, what: string): Promise<void> {
    if (res.status === 409) {
      let exitCode: number | null | undefined;
      try { exitCode = ((await res.json()) as { exitCode?: number | null }).exitCode; } catch { /* no body */ }
      throw new Error(`session exited (code ${exitCode ?? "unknown"})`);
    }
    if (!res.ok && res.status !== 204) throw new Error(`${what} ${res.status}`);
    if (res.status === 200) {
      try {
        const ack = (await res.json()) as { echoed?: boolean };
        if (ack.echoed === false) {
          this.logger.warn("input not echoed within the barrier — PTY may be wedged", { sessionId });
        }
      } catch { /* older server: empty/plain body */ }
    }
  }

  private async fetchGridMeta(sessionId: string): Promise<{ text: string; seq: number; lastOutputMs: number }> {
    const res = await this.authedFetch(`${this.opts.webtermUrl}/api/sessions/${sessionId}/text`);
    if (!res.ok) throw new Error(`fetchGridText ${res.status}`);
    return {
      text: await res.text(),
      // NaN when the server predates the headers — callers treat that as
      // "signal unavailable" and keep legacy behavior.
      seq: Number(res.headers.get("x-webterm-seq") ?? NaN),
      lastOutputMs: Number(res.headers.get("x-webterm-last-output-ms") ?? NaN),
    };
  }

  private async fetchGridText(sessionId: string): Promise<string> {
    return (await this.fetchGridMeta(sessionId)).text;
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
    // Drain in-flight turns before tearing down (claw-wb4a). Mark each session
    // dead FIRST so a turn blocked in waitForPromptReady throws and posts its
    // warning — then await those turns within a bounded window so
    // their Slack writes complete. Setting alive=false is purely the local
    // handler's view; it does NOT kill the webterm session, so claw-usdo title
    // adoption after restart is unaffected.
    const inFlight: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      session.alive = false;
      if (session.inFlight) inFlight.push(session.inFlight);
    }
    if (inFlight.length > 0) {
      await Promise.race([
        Promise.allSettled(inFlight).then(() => {}),
        sleep(SHUTDOWN_DRAIN_MS),
      ]);
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
