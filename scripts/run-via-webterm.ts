#!/usr/bin/env -S npx tsx
// claude_via_webterm — run a one-shot prompt through a persistent webterm-hosted
// interactive `claude` session, replacing the API-billed `claude -p` path for
// launchd jobs (epic claw-hvpv). The interactive REPL runs under OAuth/Max, so
// the marginal cost is $0; the job's side-effects (MCP work) happen during the
// turn exactly as they did headlessly.
//
// Usage:
//   npx tsx scripts/run-via-webterm.ts --job <name> --prompt-file <path> \
//     [--cwd <dir>] [--timeout-ms <ms>] [--claude-cmd "<cmd>"] [--keep-alive]
//
// Prints the captured assistant response to stdout. Exit 0 = the turn completed
// (claude went idle after producing a response); 1 = boot/turn/timeout failure.
//
// Design notes:
//  - Long job prompts can't be echo-anchored (claude echoes the full multi-line
//    paste, but extractTurn's `❯ `+text match is unreliable across the wrap/
//    blank-line shape). So completion is detected structurally: a ⏺ response
//    block is present, NO spinner glyph is active (claude isn't mid-tool/think),
//    and the grid has been stable for STABLE_POLLS — i.e. claude is idle and
//    done. This tolerates between-tool pauses (those show a spinner or a
//    changing grid) without exiting early.
//  - The answer is captured best-effort (first ⏺ to footer) for logging.
//  - Sessions are titled "launchd <job>" and adopted if a warm one survives
//    (--keep-alive); by default the session is killed after the run so they
//    don't accumulate (the slack-bot's 30-min reaper ignores non-"slack-bot "
//    titles).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---- args ----
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const JOB = arg("job");
const PROMPT_FILE = arg("prompt-file");
const CWD = arg("cwd", `${process.env.HOME}/projects/claudeclaw`)!;
const TIMEOUT_MS = Number(arg("timeout-ms", "600000"));
// Batch/launchd default: sonnet, latest generation (Dustin, 2026-08-09 — always
// the newest sonnet/opus, never haiku). This default drives SIX claudeclaw
// launchd jobs (ai-digest, email-triage, finance-ingest, health-weekly,
// morning-brief, retrospective) — none of them pass --claude-cmd, so editing
// this line changes all six. The always-on Slack bot runs opus separately via
// WEBTERM_DIRECT_SPAWN_CMD; these unattended jobs are summarization-shaped and
// scheduled, so they stay on sonnet.
//
// Permissions: --permission-mode auto, NOT --dangerously-skip-permissions
// (Dustin, 2026-08-09). These six run unattended at fixed hours with nobody to
// answer a prompt, so this was validated through this exact runner first — a
// turn completed unprompted, including a shell write outside the cwd. Residual
// risk if auto ever does prompt: the turn stalls rather than erroring, and
// TIMEOUT_MS below is the only thing that converts that into a logged failure.
const CLAUDE_CMD = arg("claude-cmd", "claude --model claude-sonnet-5 --permission-mode auto")!;
const KEEP_ALIVE = process.argv.includes("--keep-alive");
const WEBTERM_URL = process.env.WEBTERM_URL ?? "http://127.0.0.1:7681";
if (!JOB || !PROMPT_FILE) { console.error("usage: --job <name> --prompt-file <path> [--cwd] [--timeout-ms] [--claude-cmd] [--keep-alive]"); process.exit(1); }
if (!existsSync(PROMPT_FILE)) { console.error(`prompt file not found: ${PROMPT_FILE}`); process.exit(1); }
const PROMPT = readFileSync(PROMPT_FILE, "utf8");
const TITLE = `launchd ${JOB}`;

// ---- webterm api ----
const TOKEN = (() => {
  const env = process.env.WEBTERM_TOKEN?.trim();
  if (env) return env;
  const f = process.env.WEBTERM_TOKEN_FILE ?? join(homedir(), ".webterm", "token");
  return existsSync(f) ? readFileSync(f, "utf8").trim() : "";
})();
const H: Record<string, string> = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => process.stderr.write(`[run-via-webterm:${JOB}] ${m}\n`);

async function api(path: string, init?: RequestInit) {
  return fetch(`${WEBTERM_URL}${path}`, { ...init, headers: { ...(init?.headers as Record<string, string>), ...H } });
}
async function postJson(path: string, body: unknown) {
  const r = await api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok && r.status !== 204) throw new Error(`POST ${path} -> ${r.status}`);
  return r;
}
async function gridText(id: string): Promise<string> {
  // Nonce-delimited frame (claw-3btg.7): this grid text is consumed by an LLM
  // downstream, so fetch it wrapped in one-time markers and validate the frame
  // — a malicious/compromised TUI can't forge the closing delimiter to smuggle
  // instructions. Falls back to the raw body on pre-nonce servers.
  const r = await api(`/api/sessions/${id}/text?delimit=nonce`);
  if (!r.ok) throw new Error(`GET /text -> ${r.status}`);
  const body = await r.text();
  const m = body.match(/^<<<WEBTERM_OUTPUT_([0-9a-f]{8})>>>\n([\s\S]*)\n<<<END_WEBTERM_OUTPUT_\1>>>$/);
  if (m) return m[2];
  if (body.startsWith("<<<WEBTERM_OUTPUT_")) throw new Error("nonce frame validation failed — truncated or forged delimiter");
  return body; // pre-nonce server
}
async function paste(id: string, data: string) { await postJson(`/api/sessions/${id}/input`, { kind: "paste", data }); }
async function send(id: string, data: string) { await postJson(`/api/sessions/${id}/input`, { kind: "text", data }); }
async function enter(id: string) { await postJson(`/api/sessions/${id}/input`, { kind: "keys", keys: ["Enter"] }); }
async function kill(id: string) { await api(`/api/sessions/${id}`, { method: "DELETE" }).catch(() => {}); }

// ---- grid signals ----
const MODEL_ROW = /(Opus|Fable|Sonnet|Haiku|Mythos)\s+\d/;
// ACTIVE spinner = claude is working: a glyph + a verb ENDING IN AN ELLIPSIS
// ("✻ Cogitating…", "✶ Running… (esc to interrupt)"). Distinct from the
// COMPLETED duration indicator ("✻ Cogitated for 3s"), which persists in the
// idle state and must NOT count as "working" — that bug made completion never
// fire. captureResponse strips BOTH forms (ANY_SPINNER) as chrome.
const ACTIVE_SPINNER = /^[✻✶✳✢✽⠂⠐⠈⠁·]\s+.*…/;
const ANY_SPINNER = /^[✻✶✳✢✽⠂⠐⠈⠁·]\s/;
const TRUST_DIALOG = /Is this a project you created or one you trust|Yes, I trust this folder/;
const ASSISTANT_MARKER = "⏺ ";
const PROMPT_MARKER = "❯";

function hasSpinner(grid: string): boolean {
  return grid.split("\n").some((l) => ACTIVE_SPINNER.test(l.trim()));
}
// Strip the elements that tick even when claude is at rest, so a stability
// check doesn't bounce forever (mirrors webterm's promptReadyNormalize): the
// status-line wall-clock, spinner durations, token/cost meters, and ms timings.
// Without this, the "⏱ Ns" tick makes raw grid equality never hold.
function normalize(grid: string): string {
  return grid
    .replace(/⏱\s*\d+s/g, "⏱ Ns")
    .replace(/\(\d+s\s*·\s*[↓↑]\d+\s+tokens\)/g, "(Ns · ↓N tokens)")
    .replace(/(\S+(?:ing|ed))\s+for\s+\d+s/g, "$1 for Ns")
    .replace(/\(\d+(?:\.\d+)?[a-zA-Z]?\)\s*│/g, "(N) │")
    .replace(/\$\d+\.\d+/g, "$N")
    .replace(/\b\d+ms\b/g, "Nms");
}
function hasResponse(grid: string): boolean {
  return grid.split("\n").some((l) => l.startsWith(ASSISTANT_MARKER));
}
// Best-effort answer capture: from the FIRST ⏺ block to the footer/input box,
// dropping spinner/rule/status chrome. Not echo-anchored, so it works for long
// prompts; precision isn't critical (this is a log line, the work is the MCP
// side-effects).
function captureResponse(grid: string): string {
  const lines = grid.split("\n");
  let start = lines.findIndex((l) => l.startsWith(ASSISTANT_MARKER));
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === PROMPT_MARKER) break;                              // bottom input box
    if (/^─{4,}$/.test(t)) break;                                // footer rule
    if (MODEL_ROW.test(t)) break;                                // status row
    if (ANY_SPINNER.test(t)) continue;                           // spinner (active or completed)
    if (i === start) { out.push(t.slice(ASSISTANT_MARKER.length)); continue; }
    out.push(lines[i].replace(/^\s{0,3}/, ""));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- session lifecycle ----
async function adoptSession(): Promise<string | null> {
  try {
    const r = await api(`/api/sessions`);
    if (!r.ok) return null;
    const list = (await r.json()) as { id: string; title?: string; alive?: boolean }[];
    const m = list.find((s) => s.alive !== false && s.title === TITLE);
    if (!m) return null;
    const g = await gridText(m.id);
    if (!MODEL_ROW.test(g)) { await kill(m.id); return null; } // bare shell — recreate
    log(`adopted warm session ${m.id}`);
    return m.id;
  } catch { return null; }
}

async function createAndBoot(): Promise<string> {
  const r = await postJson(`/api/sessions`, { title: TITLE, cols: 120, rows: 40, cwd: CWD });
  const id = ((await r.json()) as { id: string }).id;
  log(`created session ${id}; booting claude in ${CWD}`);
  await send(id, CLAUDE_CMD);
  await sleep(200);
  await enter(id);
  // Poll for boot: the model-status row + input box appear; accept the trust
  // dialog if it blocks (claw-g790).
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    const g = await gridText(id);
    if (TRUST_DIALOG.test(g)) { log("accepting trust-folder dialog"); await enter(id); continue; }
    if (MODEL_ROW.test(g) && g.includes(PROMPT_MARKER)) {
      // MCP servers (Gmail, Slack, Calendar, …) connect ASYNC after the prompt
      // box appears — they're "still connecting" for several seconds. Sending
      // the job prompt before they're ready makes its tool calls fail. Wait a
      // settle window so MCP is connected before the turn (a fresh boot only;
      // adopted warm sessions already have MCP up).
      const settle = Number(arg("mcp-settle-ms", "12000"));
      log(`booted; settling ${settle}ms for MCP servers to connect`);
      await sleep(settle);
      return id;
    }
  }
  await kill(id);
  throw new Error("claude did not boot within 60s");
}

// ---- run the turn ----
async function runTurn(id: string): Promise<string> {
  await paste(id, PROMPT);
  await sleep(1000); // paste-settle (an immediate Enter is swallowed into the paste)
  await enter(id);
  log("prompt submitted; waiting for completion");

  const STABLE_POLLS = 4;   // ~8s of no change + no spinner = claude idle/done
  const POLL_MS = 2000;
  const deadline = Date.now() + TIMEOUT_MS;
  let prev = "";
  let stable = 0;
  let lastResponse = "";
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let g: string;
    try { g = await gridText(id); } catch (e) { throw new Error(`grid fetch failed: ${(e as Error).message}`); }
    const norm = normalize(g);
    const idle = hasResponse(g) && !hasSpinner(g) && norm === prev;
    prev = norm;
    if (idle) {
      stable++;
      if (stable === 1) lastResponse = captureResponse(g);
      if (stable >= STABLE_POLLS) { log(`completed (idle ${STABLE_POLLS}×${POLL_MS}ms)`); return lastResponse || captureResponse(g); }
    } else {
      stable = 0;
    }
  }
  throw new Error(`turn did not complete within ${TIMEOUT_MS}ms`);
}

async function main() {
  let id = await adoptSession();
  const created = id === null;
  if (id === null) id = await createAndBoot();
  try {
    const answer = await runTurn(id);
    process.stdout.write(answer + "\n");
    if (!KEEP_ALIVE) { await kill(id); log("session killed (use --keep-alive to reuse)"); }
    process.exit(0);
  } catch (err) {
    log(`FAILED: ${(err as Error).message}`);
    // Kill on failure if we created it, so a half-booted session doesn't linger.
    if (created && !KEEP_ALIVE) await kill(id);
    process.exit(1);
  }
}
main().catch((e) => { console.error("run-via-webterm fatal:", e); process.exit(1); });
