// The turn-loop primitives — boot, relay wake, idle detection, abort —
// re-pointed at herdr (trk-s5d.3). This is ONLY the loop AROUND
// webterm-claude-extractor: extractTurn/extractSegments/isGridIdle need zero
// changes and are imported unchanged below. Session-map/multi-thread
// orchestration (thread adoption, idle reaping) stays with trk-s5d.4 — every
// function here operates on a single already-existing pane_id.
//
// DO NOT add calls to herdr's agent-state/agent-status APIs (agent.get,
// agent.list, agent.explain) here for turn-control decisions: herdr reported
// a Codex agent parked on a blocking modal as "idle" (it fell through to
// osc_title_idle title-scraping). The bot's own extractor + isGridIdle stay
// the sole turn-control signal — herdr is used here only for boot (agent.start)
// and transport (pane.read / pane.send_keys / events.subscribe).

import { HerdrClient, HerdrError, HerdrEventStream, type HerdrClientOptions } from "./herdr/client";
import type { HerdrRequest, HerdrResponse } from "./herdr/generated";
import { isGridIdle } from "./webterm-claude-extractor";

// Ported from webterm-runtime-handler.ts's DEFAULT_IDLE_OUTPUT_FLOOR_MS
// (claw-3btg.4): the minimum time since the pane's last real output change
// before an idle-LOOKING frame may count toward stable idle. claude removes
// its spinner while it's still streaming prose, so a frame fetched mid-paint
// reads as idle on isGridIdle alone.
export const DEFAULT_IDLE_OUTPUT_FLOOR_MS = 250;

// Ported from webterm-runtime-handler.ts's DEFAULT_SLIDING_INACTIVITY_MS
// (claw-gxzq): the relay loop has no fixed turn cap — it aborts only when the
// pane looks WEDGED, i.e. no change and not idle, for this long.
export const DEFAULT_SLIDING_INACTIVITY_MS = 5 * 60_000;

export interface BootAgentOpts {
  /** herdr agent name (the bot's thread/session identity). */
  name: string;
  /** herdr agent kind, e.g. "claude". */
  kind?: string;
  /** The pane the agent boots into — the PTY-holder (trk-s5d.2) owns its geometry. */
  paneId: string;
  args?: string[];
  /** Startup timeout in ms; herdr requires >3000 and <=300000 when set. */
  timeoutMs?: number;
}

// BOOT: 'agent start <name> --kind claude --pane <id>' returns only once
// herdr has detected the agent and considers it ready for input, or fails
// with an error (observed live: agent_not_ready) immediately. This replaces
// webterm's hand-rolled handshake (bootTimeoutMs, promptReadyCount==0 wait,
// directSpawnCommand/WEBTERM_SPAWN_ALLOWLIST) outright — herdr's own
// trust_directory blocker rule fires correctly on claude's trust-folder
// prompt, so there is no dialog-detection loop to port here either.
export async function bootAgent(client: HerdrClient, opts: BootAgentOpts): Promise<HerdrResponse.AgentStartResponse> {
  try {
    return await client.call("agent.start", {
      name: opts.name,
      kind: opts.kind ?? "claude",
      pane_id: opts.paneId,
      args: opts.args ?? [],
      timeout_ms: opts.timeoutMs ?? null,
    });
  } catch (err) {
    if (err instanceof HerdrError) {
      throw new Error(`agent boot failed (${err.code}): ${err.message}`);
    }
    throw err;
  }
}

export interface ReadPaneOpts {
  source?: HerdrRequest.ReadSource;
}

// READS gotcha (trk-s5d.3): never pass `lines` — a bounded value counts
// SCREEN ROWS INCLUDING BLANK PADDING, so a small N on a mostly-empty pane
// silently returns zero bytes with exit 0. Always read the full pane instead.
export async function readPane(
  client: HerdrClient,
  paneId: string,
  opts: ReadPaneOpts = {},
): Promise<{ text: string; revision: number }> {
  const res = await client.call("pane.read", {
    pane_id: paneId,
    source: opts.source ?? "visible",
  });
  return { text: res.read.text, revision: res.read.revision };
}

// ABORT: 'pane send-keys <target> esc' / 'ctrl+c'. herdr validates all keys
// before writing any bytes, so an invalid key name rejects the call instead
// of corrupting the pane.
export async function sendKeys(client: HerdrClient, paneId: string, keys: string[]): Promise<void> {
  await client.call("pane.send_keys", { pane_id: paneId, keys });
}

export type AbortMode = "esc" | "ctrl+c";

// "stop" from Slack (mirrors WebtermRuntimeHandler.abortTurn): interrupt
// claude's current generation. The interrupted turn then finalizes through
// the normal relay path with whatever content had rendered.
export async function abortTurn(client: HerdrClient, paneId: string, mode: AbortMode = "esc"): Promise<void> {
  await sendKeys(client, paneId, [mode]);
}

// IDLE FLOOR (the one real capability gap, trk-s5d.3): webterm's
// x-webterm-last-output-ms header backed idleOutputFloorMs; herdr exposes no
// equivalent field. WORKAROUND: time revision bumps ourselves and derive the
// same floor from time-since-last-bump. herdr's `revision` only bumps on
// real pane output (see src/herdr/client.ts's CAVEAT note), so "ms since the
// observed revision last changed" is the same signal the header carried —
// just timestamped client-side instead of server-side.
export class RevisionClock {
  private lastRevision: number | null = null;
  private lastBumpAt = 0;

  /** Returns ms elapsed since `revision` last differed from the prior observation. */
  observe(revision: number, now: number = Date.now()): number {
    if (this.lastRevision === null || revision !== this.lastRevision) {
      this.lastRevision = revision;
      this.lastBumpAt = now;
      return 0;
    }
    return now - this.lastBumpAt;
  }
}

export interface IdleCheckOpts {
  idleOutputFloorMs?: number;
}

// Ports the webterm relay's `idle` computation (claw-3btg.4) onto herdr's
// revision counter instead of the x-webterm-last-output-ms header: idle =
// idle-looking grid AND paint settled (no revision bump within the floor).
export function isRelayIdle(
  gridText: string,
  revision: number,
  clock: RevisionClock,
  opts: IdleCheckOpts = {},
  now: number = Date.now(),
): boolean {
  const floor = opts.idleOutputFloorMs ?? DEFAULT_IDLE_OUTPUT_FLOOR_MS;
  const msSinceBump = clock.observe(revision, now);
  const paintSettled = msSinceBump >= floor;
  return isGridIdle(gridText) && paintSettled;
}

// RELAY: wake on herdr's pane.updated push (per trk-s5d.1's finding —
// pane_output_changed itself has no Subscription variant; pane.updated is
// the reachable substitute and fires on the same revision-bumping triggers).
// Falls back to the poll timeout when no push arrives, mirroring
// waitForTurnSignal's dual wake (fast-path event OR poll tick) so a missed
// push can never strand the loop.
export class PaneRelay {
  private stream: HerdrEventStream | null = null;
  private opening: Promise<void> | null = null;

  constructor(private readonly clientOpts: HerdrClientOptions = {}) {}

  private ensureOpen(): Promise<HerdrEventStream> {
    if (!this.stream) {
      const stream = new HerdrEventStream(this.clientOpts);
      this.stream = stream;
      this.opening = stream.open([{ type: "pane.updated" }]).then(() => {});
    }
    return this.opening!.then(() => this.stream!);
  }

  /** Resolves "pushed" on the pane's next pane.updated event, or "timeout" after `ms`. */
  async waitForChange(paneId: string, ms: number): Promise<"pushed" | "timeout"> {
    const stream = await this.ensureOpen();
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve("timeout");
      }, ms);
      const unsubscribe = stream.onPaneUpdated(paneId, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve("pushed");
      });
    });
  }

  close(): void {
    this.stream?.close();
    this.stream = null;
    this.opening = null;
  }
}

// Wedged-pane guard — ports webterm's sliding-inactivity check unchanged
// (claw-gxzq): the relay loop has no fixed turn cap for long agentic tasks,
// so it aborts only when the pane hasn't changed AND isn't idle for this long.
export function isWedged(lastChangeAt: number, opts: { slidingInactivityMs?: number } = {}, now: number = Date.now()): boolean {
  const limit = opts.slidingInactivityMs ?? DEFAULT_SLIDING_INACTIVITY_MS;
  return now - lastChangeAt > limit;
}
