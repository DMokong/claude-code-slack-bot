#!/usr/bin/env -S npx tsx
// End-to-end healthcheck for the herdr-driven claude runtime path.
//
// Exercises the chain the bot uses for routed channels:
//   1. herdr binary reachable
//   2. spin up a throwaway synthetic-PTY-held herdr session (146x201 PTY,
//      pinning the pane at webterm's old 120x200 geometry — see
//      docs/runbooks/herdr-pty-holder.md in claudeclaw)
//   3. resolve the session's pane id
//   4. boot `claude` in the configured cwd, poll until its status bar renders
//   5. send a known-answer turn ("what is 2 plus 2?") — send-text + settle
//      delay + Enter, mirroring the bracketed-paste settle the old webterm
//      handler used
//   6. poll `pane read --source visible` and feed it straight into the
//      PRODUCTION extractor (extractTurn) until two consecutive polls agree,
//      the same render-settle guard the webterm path used (claw-etj7)
//   7. format for Slack
//   8. assert the extracted text contains the expected answer marker
//  cleanup: stop/delete the throwaway session, kill the PTY-holder.
//
// Run from the slack-bot repo root:
//   npx tsx scripts/healthcheck-webterm-claude.ts
//   HERDR_HEALTHCHECK_CWD=/other/dir npx tsx scripts/healthcheck-webterm-claude.ts
//
// Exit 0 = healthy, 1 = any step failed.

import { extractTurn, formatTurnForSlack } from "../src/webterm-claude-extractor";
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const HERDR_BIN = process.env.HERDR_BIN ?? "herdr";
// A throwaway named session, distinct from any production session (e.g. the
// bot's own "slack-bot" session held by com.claudeclaw.herdr-pty) — never
// point this at a session name that's already in production use.
const HERDR_SESSION = process.env.HERDR_HEALTHCHECK_SESSION ?? "webterm-claude-healthcheck";
// pane = (pty_cols - 26) x (pty_rows - 1) — measured, see
// docs/runbooks/herdr-pty-holder.md. 146x201 -> 120x200, webterm's old size.
const HERDR_PTY_COLS = Number(process.env.HERDR_PTY_COLS ?? 146);
const HERDR_PTY_ROWS = Number(process.env.HERDR_PTY_ROWS ?? 201);
const HERDR_PTY_HOLDER_PATH =
  process.env.HERDR_PTY_HOLDER_PATH ?? join(homedir(), "projects", "claudeclaw", "scripts", "herdr-pty-holder.py");
const HERDR_PTY_READY_TIMEOUT_MS = Number(process.env.HERDR_PTY_READY_TIMEOUT_MS ?? 15_000);

const CWD = process.env.HERDR_HEALTHCHECK_CWD ?? `${process.env.HOME}/projects/claudeclaw`;
const CLAUDE_CMD = process.env.HERDR_HEALTHCHECK_CLAUDE_CMD ?? "claude --dangerously-skip-permissions";
const BOOT_TIMEOUT_MS = Number(process.env.BOOT_TIMEOUT_MS ?? 30_000);
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? 90_000);
const HEALTHCHECK_PROMPT = process.env.HEALTHCHECK_PROMPT ?? "what is 2 plus 2? answer in one short sentence.";
const HEALTHCHECK_EXPECT = process.env.HEALTHCHECK_EXPECT ?? "4";

// Mirrors the extractor's own model-status-row anchor (src/webterm-claude-extractor.ts)
// closely enough to recognize "claude's TUI has rendered its status bar" without
// importing extractor internals — the extractor module itself stays untouched.
const MODEL_STATUS_ROW = /^\s*(Opus|Fable|Sonnet|Haiku|Mythos)\s+\d/m;

// ----- terminal output helpers -----

const isTTY = process.stderr.isTTY;
const c = {
  green: (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red: (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  dim: (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  bold: (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
};

interface StepResult {
  name: string;
  ok: boolean;
  elapsedMs: number;
  detail?: string;
  error?: string;
  hint?: string;
}

const results: StepResult[] = [];
const overallStart = Date.now();
let stepIndex = 0;
const totalSteps = 8;
// Mirror the production handler: wait out claude's paste-aggregation window
// before Enter, or the submit keystroke is swallowed into the paste.
const PASTE_SETTLE_MS = 1_000;

async function step<T>(name: string, fn: () => Promise<T>, hint?: string): Promise<T> {
  stepIndex++;
  const label = `[${stepIndex}/${totalSteps}] ${name}`;
  process.stderr.write(`${label} ... `);
  const t0 = Date.now();
  try {
    const value = await fn();
    const elapsedMs = Date.now() - t0;
    results.push({ name, ok: true, elapsedMs });
    process.stderr.write(`${c.green("✓")} ${c.dim(`${elapsedMs}ms`)}\n`);
    return value;
  } catch (err) {
    const elapsedMs = Date.now() - t0;
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, elapsedMs, error, hint });
    process.stderr.write(`${c.red("✗")} ${c.dim(`${elapsedMs}ms`)}\n`);
    process.stderr.write(`        ${c.red(error)}\n`);
    if (hint) process.stderr.write(`        ${c.yellow("hint: " + hint)}\n`);
    throw err;
  }
}

function infoLine(text: string) {
  process.stderr.write(`        ${c.dim(text)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ----- herdr CLI transport -----
//
// Every invocation is explicitly scoped with --session <HERDR_SESSION>. Never
// call the herdr CLI without an explicit --session here: an unscoped call
// falls back to whatever session is ambient (e.g. a live interactive one) and
// can silently attach an ephemeral client that resizes its pane (see
// docs/runbooks/herdr-pty-holder.md, "Decision 2").

function spawnHerdr(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(HERDR_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`herdr ${args.join(" ")} exited ${code}: ${(stderr || stdout).trim()}`));
    });
  });
}

// Pane/layout/current subcommands are scoped to a session via the global
// --session flag.
function runHerdr(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return spawnHerdr(["--session", HERDR_SESSION, ...args]);
}

// `session stop`/`session delete` are meta-commands issued against the
// ambient connection with the target session name as a POSITIONAL argument —
// they do NOT take the global --session flag (that flag would mean "scope
// this call to a socket that's about to stop existing", which is not what
// these commands are for).
function runHerdrSessionCmd(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return spawnHerdr(args);
}

async function herdrJson<T>(args: string[]): Promise<T> {
  const { stdout } = await runHerdr(args);
  return JSON.parse(stdout).result as T;
}

// ----- synthetic-PTY session bootstrap -----
// Reuses the pattern from claudeclaw's scripts/herdr-pty-holder.py: a client
// attached under a synthetic 146x201 PTY pins the session's pane at 120x200,
// webterm's old geometry. See docs/runbooks/herdr-pty-holder.md.

let ptyHolder: ChildProcess | null = null;

async function startThrowawaySession(): Promise<void> {
  // Defensive: a prior crashed run may have left this throwaway session
  // behind. Clear it before claiming the name again.
  await runHerdrSessionCmd(["session", "stop", HERDR_SESSION]).catch(() => {});
  await runHerdrSessionCmd(["session", "delete", HERDR_SESSION]).catch(() => {});

  ptyHolder = spawn(
    "python3",
    [HERDR_PTY_HOLDER_PATH, "--session", HERDR_SESSION, "--cols", String(HERDR_PTY_COLS), "--rows", String(HERDR_PTY_ROWS)],
    { cwd: CWD, stdio: ["ignore", "pipe", "pipe"] },
  );
  ptyHolder.on("error", () => {}); // surfaced via the geometry-poll timeout below

  const expectedWidth = HERDR_PTY_COLS - 26;
  const expectedHeight = HERDR_PTY_ROWS - 1;
  const deadline = Date.now() + HERDR_PTY_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const layout = await herdrJson<{ layout: { area: { width: number; height: number } } }>([
        "pane",
        "layout",
        "--current",
      ]);
      if (layout.layout.area.width === expectedWidth && layout.layout.area.height === expectedHeight) return;
    } catch {
      // session/pane not attached yet — keep polling
    }
    await sleep(300);
  }
  throw new Error(
    `herdr session ${HERDR_SESSION} never resolved its pane to ${expectedWidth}x${expectedHeight} within ${HERDR_PTY_READY_TIMEOUT_MS}ms`,
  );
}

async function getPaneId(): Promise<string> {
  const current = await herdrJson<{ pane: { pane_id: string } }>(["pane", "current", "--current"]);
  return current.pane.pane_id;
}

async function killThrowawaySession(): Promise<void> {
  await runHerdrSessionCmd(["session", "stop", HERDR_SESSION]).catch(() => {});
  if (ptyHolder && ptyHolder.exitCode === null && !ptyHolder.killed) {
    ptyHolder.kill("SIGTERM");
  }
  // "delete" requires the session to have actually finished transitioning to
  // stopped server-side — "stop" returning doesn't guarantee that happened
  // yet, so retry rather than racing the state change (observed: a bare
  // stop-then-delete left the session behind, still "running").
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await runHerdrSessionCmd(["session", "delete", HERDR_SESSION]);
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error(`session ${HERDR_SESSION} stopped but never reached a deletable state`);
}

// ----- pane I/O -----

async function sendInput(paneId: string, text: string, opts: { settleMs?: number } = {}): Promise<void> {
  await runHerdr(["pane", "send-text", paneId, text]);
  if (opts.settleMs) await sleep(opts.settleMs);
  await runHerdr(["pane", "send-keys", paneId, "enter"]);
}

async function fetchGridText(paneId: string): Promise<string> {
  const { stdout } = await runHerdr(["pane", "read", paneId, "--source", "visible"]);
  return stdout;
}

// ----- readiness polling -----
// herdr has no push-based "prompt ready" event on the CLI transport this
// script uses, so both boot and turn completion are plain poll loops.

async function waitForBootReady(paneId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let sawStatusRow = false;
  while (Date.now() < deadline) {
    const grid = await fetchGridText(paneId);
    if (MODEL_STATUS_ROW.test(grid)) {
      if (sawStatusRow) return; // seen on two consecutive polls — rendered, not mid-paint
      sawStatusRow = true;
    } else {
      sawStatusRow = false;
    }
    await sleep(750);
  }
  throw new Error(`claude did not reach a ready state (status bar never rendered) within ${timeoutMs}ms`);
}

async function waitForTurnAndExtract(
  paneId: string,
  prompt: string,
  timeoutMs: number,
): Promise<ReturnType<typeof extractTurn>> {
  const deadline = Date.now() + timeoutMs;
  let last: ReturnType<typeof extractTurn> = null;
  let pollCount = 0;
  while (Date.now() < deadline) {
    pollCount++;
    const grid = await fetchGridText(paneId);
    const t = extractTurn(grid, prompt);
    if (t !== null && t.assistant.trim().length > 0) {
      if (last && last.assistant === t.assistant) {
        infoLine(`stable extraction after ${pollCount} polls`);
        return t;
      }
      last = t;
    } else {
      last = null;
    }
    await sleep(1_500);
  }
  throw new Error(
    `extractor returned no stable assistant text after ${timeoutMs}ms (${pollCount} polls) — ` +
      `claude never rendered a ⏺ block, or the TUI format drifted (gotcha #8: diff /text against test/fixtures/webterm-grids/)`,
  );
}

// ----- main -----

async function main(): Promise<number> {
  process.stderr.write(c.bold("ClaudeClaw webterm-claude healthcheck (herdr transport)\n"));
  process.stderr.write(c.dim(`herdr session   = ${HERDR_SESSION}\n`));
  process.stderr.write(c.dim(`pty geometry    = ${HERDR_PTY_COLS}x${HERDR_PTY_ROWS} (pane target ${HERDR_PTY_COLS - 26}x${HERDR_PTY_ROWS - 1})\n`));
  process.stderr.write(c.dim(`cwd             = ${CWD}\n`));
  process.stderr.write(c.dim(`claude command  = ${CLAUDE_CMD}\n`));
  process.stderr.write(c.dim(`prompt          = ${JSON.stringify(HEALTHCHECK_PROMPT)}\n`));
  process.stderr.write(c.dim(`expect contains = ${JSON.stringify(HEALTHCHECK_EXPECT)}\n`));
  process.stderr.write("\n");

  let sessionStarted = false;
  let exitCode = 0;

  try {
    await step(
      `herdr binary reachable`,
      async () => {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(HERDR_BIN, ["status"], { stdio: ["ignore", "pipe", "pipe"] });
          child.on("error", reject);
          child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`herdr status exited ${code}`))));
        });
      },
      "install herdr and make sure the server is running: herdr status",
    );

    await step(
      `spin up throwaway herdr session ${HERDR_SESSION} (${HERDR_PTY_COLS}x${HERDR_PTY_ROWS} PTY)`,
      async () => {
        await startThrowawaySession();
        sessionStarted = true;
      },
      `check com.claudeclaw.herdr-pty isn't already holding this session name, and that ${HERDR_PTY_HOLDER_PATH} exists`,
    );

    const paneId = await step(
      "resolve session pane id",
      async () => getPaneId(),
    );
    infoLine(`pane id = ${paneId}`);

    const bootStart = Date.now();
    await step(
      `boot claude in ${CWD}`,
      async () => {
        infoLine(`sending: ${CLAUDE_CMD}`);
        infoLine(`waiting for status bar to render (timeout ${BOOT_TIMEOUT_MS}ms)`);
        await sendInput(paneId, CLAUDE_CMD);
        await waitForBootReady(paneId, BOOT_TIMEOUT_MS);
      },
      `if it times out: claude might be hitting the "trust this folder" dialog (claw-g790). Use a cwd you've opened with \`claude\` at least once.`,
    );
    infoLine(`boot completed in ${Date.now() - bootStart}ms`);

    const turnStart = Date.now();
    await step(
      `send turn: ${JSON.stringify(HEALTHCHECK_PROMPT)}`,
      async () => {
        // Bracketed paste + settle, same as the production handler's turn path.
        await sendInput(paneId, HEALTHCHECK_PROMPT, { settleMs: PASTE_SETTLE_MS });
      },
    );

    const turn = await step(
      `poll pane + extract turn (timeout ${TURN_TIMEOUT_MS}ms)`,
      async () => waitForTurnAndExtract(paneId, HEALTHCHECK_PROMPT, TURN_TIMEOUT_MS),
    );
    if (!turn) throw new Error("unreachable: waitForTurnAndExtract resolves or throws");
    infoLine(`turn completed in ${Date.now() - turnStart}ms`);
    infoLine(`assistant: ${JSON.stringify(turn.assistant.slice(0, 120))}${turn.assistant.length > 120 ? "…" : ""}`);
    if (turn.toolNotes.length > 0) infoLine(`toolNotes: ${JSON.stringify(turn.toolNotes)}`);

    const slackText = await step(
      "format for Slack",
      async () => formatTurnForSlack(turn),
    );
    infoLine(`slack output: ${JSON.stringify(slackText.slice(0, 120))}${slackText.length > 120 ? "…" : ""}`);

    await step(
      `assertion: extracted contains ${JSON.stringify(HEALTHCHECK_EXPECT)}`,
      async () => {
        if (!turn.assistant.includes(HEALTHCHECK_EXPECT)) {
          throw new Error(
            `extracted answer ${JSON.stringify(turn.assistant)} does not contain expected marker ` +
              `${JSON.stringify(HEALTHCHECK_EXPECT)} — claude answered something else than usual`,
          );
        }
      },
      "this is a sanity check, not a correctness check — claude is non-deterministic. " +
        "If it fails, look at the assistant line above and decide if the answer is reasonable.",
    );
  } catch (err) {
    exitCode = 1;
    // first failure already logged by step(); we just stop here.
  } finally {
    if (sessionStarted) {
      try {
        process.stderr.write(`[cleanup] stop/delete session ${HERDR_SESSION} ... `);
        await killThrowawaySession();
        process.stderr.write(`${c.green("✓")}\n`);
      } catch (err) {
        process.stderr.write(`${c.yellow("⚠")} (${err instanceof Error ? err.message : String(err)})\n`);
      }
    }
  }

  const totalMs = Date.now() - overallStart;
  process.stderr.write("\n");
  if (exitCode === 0) {
    process.stderr.write(`${c.green("OK")} — webterm-claude pipeline is healthy. ${c.dim(`total: ${totalMs}ms`)}\n`);
  } else {
    const firstFailure = results.find((r) => !r.ok);
    process.stderr.write(`${c.red("FAIL")} — ${firstFailure?.name ?? "unknown step"} failed. ${c.dim(`total: ${totalMs}ms`)}\n`);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(c.red("uncaught error: " + (err instanceof Error ? err.message : String(err))));
    process.exit(1);
  });
