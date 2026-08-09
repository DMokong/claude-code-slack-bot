#!/usr/bin/env -S npx tsx
// End-to-end healthcheck for the webterm-driven claude runtime path.
//
// Exercises the same chain the bot uses for routed channels:
//   1. webterm API reachable
//   2. (optional) webterm UI reachable
//   3. create webterm session
//   4. subscribe to SSE with promptReady=true
//   5. boot `claude` in the configured cwd
//   6. send a known-answer turn ("what is 2 plus 2?") — bracketed paste +
//      settle delay, mirroring the production handler's input path
//   7. fetch grid + extract assistant turn via the PRODUCTION extractor,
//      retrying on empty extraction like the bot does (claw-etj7 compensation)
//   8. format for Slack
//   9. assert the extracted text contains the expected answer marker
//  cleanup. kill session.
//
// Run from the slack-bot repo root:
//   npx tsx scripts/healthcheck-webterm-claude.ts
//   npx tsx scripts/healthcheck-webterm-claude.ts --ui          # also probe Vite UI
//   WEBTERM_URL=http://other:7681 npx tsx scripts/healthcheck-webterm-claude.ts
//
// Exit 0 = healthy, 1 = any step failed.

import { extractTurn, formatTurnForSlack } from "../src/webterm-claude-extractor";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The webterm API requires a bearer token (claw-yv02); read it the same way the
// bot does (env, else the shared token file).
function resolveToken(): string {
  const env = process.env.WEBTERM_TOKEN?.trim();
  if (env) return env;
  try {
    const f = process.env.WEBTERM_TOKEN_FILE ?? join(homedir(), ".webterm", "token");
    return existsSync(f) ? readFileSync(f, "utf8").trim() : "";
  } catch { return ""; }
}
const TOKEN = resolveToken();
const authHeaders: Record<string, string> = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};

const WEBTERM_URL = process.env.WEBTERM_URL ?? "http://127.0.0.1:7681";
const WEBTERM_UI_URL = process.env.WEBTERM_UI_URL ?? "http://127.0.0.1:5173";
const CWD = process.env.WEBTERM_CWD ?? `${process.env.HOME}/projects/claudeclaw`;
const CLAUDE_CMD = process.env.WEBTERM_CLAUDE_CMD ?? "claude --permission-mode auto";
// Direct-spawn mode (claw-3btg.1/.12): when set, mirror production — claude IS
// the PTY child via command[] argv; no boot command is typed into a shell.
const DIRECT_SPAWN_CMD = (process.env.WEBTERM_DIRECT_SPAWN_CMD ?? "").split(/\s+/).filter(Boolean);
const COLS = Number(process.env.WEBTERM_COLS ?? 120);
const ROWS = Number(process.env.WEBTERM_ROWS ?? 40);
const BOOT_TIMEOUT_MS = Number(process.env.BOOT_TIMEOUT_MS ?? 30_000);
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? 90_000);
const HEALTHCHECK_PROMPT = process.env.HEALTHCHECK_PROMPT ?? "what is 2 plus 2? answer in one short sentence.";
const HEALTHCHECK_EXPECT = process.env.HEALTHCHECK_EXPECT ?? "4";

const includeUiCheck = process.argv.includes("--ui") || process.env.HEALTHCHECK_UI === "1";

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
const totalSteps = includeUiCheck ? 10 : 9;
// Mirror the production handler: wait out claude's paste-aggregation window
// before Enter, or the submit keystroke is swallowed into the paste.
const PASTE_SETTLE_MS = 1_000;
const ETJ7_MAX_ATTEMPTS = 3;

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

// ----- webterm API -----

async function createSession(): Promise<{ id: string; cols: number; rows: number; command?: string[] }> {
  const res = await fetch(`${WEBTERM_URL}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "healthcheck", cols: COLS, rows: ROWS, cwd: CWD,
      ...(DIRECT_SPAWN_CMD.length > 0 ? { command: DIRECT_SPAWN_CMD } : {}),
    }),
  });
  if (!res.ok) throw new Error(`POST /api/sessions returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { id: string; cols: number; rows: number; command?: string[] };
  if (DIRECT_SPAWN_CMD.length > 0 && !Array.isArray(body.command)) {
    throw new Error("direct-spawn requested but the server did not echo command[] — check WEBTERM_SPAWN_ALLOWLIST");
  }
  return body;
}

async function killSession(id: string): Promise<void> {
  await fetch(`${WEBTERM_URL}/api/sessions/${id}`, { method: "DELETE", headers: { ...authHeaders } });
}

async function sendInput(
  id: string,
  text: string,
  opts: { kind?: "text" | "paste"; settleMs?: number } = {},
): Promise<void> {
  const base = `${WEBTERM_URL}/api/sessions/${id}/input`;
  const a = await fetch(base, { method: "POST", headers: { "content-type": "application/json", ...authHeaders }, body: JSON.stringify({ kind: opts.kind ?? "text", data: text }) });
  if (!a.ok && a.status !== 204) throw new Error(`POST /input text returned ${a.status}`);
  if (opts.settleMs) await sleep(opts.settleMs);
  const b = await fetch(base, { method: "POST", headers: { "content-type": "application/json", ...authHeaders }, body: JSON.stringify({ kind: "keys", keys: ["Enter"] }) });
  if (!b.ok && b.status !== 204) throw new Error(`POST /input enter returned ${b.status}`);
}

async function fetchGridText(id: string): Promise<string> {
  const res = await fetch(`${WEBTERM_URL}/api/sessions/${id}/text`, { headers: { ...authHeaders } });
  if (!res.ok) throw new Error(`GET /text returned ${res.status}`);
  return await res.text();
}

// ----- SSE prompt-ready listener -----

interface SseHandle {
  promptReadyCount: number;
  alive: boolean;
  abort: AbortController;
  done: Promise<void>;
}

async function subscribeSse(id: string): Promise<SseHandle> {
  const url =
    `${WEBTERM_URL}/api/sessions/${id}/events` +
    `?idleMs=1500&promptReady=true&promptReadyPollMs=400&promptReadyStablePolls=3`;
  const abort = new AbortController();
  const res = await fetch(url, { headers: { accept: "text/event-stream", ...authHeaders }, signal: abort.signal });
  if (!res.ok || !res.body) throw new Error(`GET /events returned ${res.status}`);
  const handle: SseHandle = {
    promptReadyCount: 0,
    alive: true,
    abort,
    done: Promise.resolve(),
  };
  handle.done = (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of res.body as any) {
        if (abort.signal.aborted) break;
        buf += decoder.decode(chunk as Uint8Array, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const record = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = "";
          for (const line of record.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
          }
          if (event === "prompt-ready") handle.promptReadyCount++;
          else if (event === "exit") handle.alive = false;
        }
      }
    } catch {
      // signal abort or stream end — caller handles via .alive
    }
  })();
  return handle;
}

async function waitForPromptReady(sse: SseHandle, target: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!sse.alive) throw new Error("session exited before reaching prompt-ready");
    if (sse.promptReadyCount >= target) return;
    await sleep(50);
  }
  throw new Error(`prompt-ready ${target} not seen within ${timeoutMs}ms (saw ${sse.promptReadyCount})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ----- main -----

async function main(): Promise<number> {
  process.stderr.write(c.bold("ClaudeClaw webterm-claude healthcheck\n"));
  process.stderr.write(c.dim(`webterm api    = ${WEBTERM_URL}\n`));
  if (includeUiCheck) process.stderr.write(c.dim(`webterm ui     = ${WEBTERM_UI_URL}\n`));
  process.stderr.write(c.dim(`cwd            = ${CWD}\n`));
  process.stderr.write(c.dim(
    DIRECT_SPAWN_CMD.length > 0
      ? `direct spawn = ${DIRECT_SPAWN_CMD.join(" ")}\n`
      : `claude command = ${CLAUDE_CMD} (legacy shell boot)\n`,
  ));
  process.stderr.write(c.dim(`prompt         = ${JSON.stringify(HEALTHCHECK_PROMPT)}\n`));
  process.stderr.write(c.dim(`expect contains = ${JSON.stringify(HEALTHCHECK_EXPECT)}\n`));
  process.stderr.write("\n");

  let sessionId: string | null = null;
  let sse: SseHandle | null = null;
  let exitCode = 0;

  try {
    await step(
      `webterm API reachable at ${WEBTERM_URL}`,
      async () => {
        const res = await fetch(`${WEBTERM_URL}/api/health`);
        if (!res.ok) throw new Error(`GET /api/health returned ${res.status}`);
        const body = await res.json();
        if (!body.ok) throw new Error(`/api/health responded { ok: false }`);
      },
      "start the server with: cd ~/projects/webterm && pnpm dev:server",
    );

    if (includeUiCheck) {
      await step(
        `webterm UI reachable at ${WEBTERM_UI_URL}`,
        async () => {
          const res = await fetch(WEBTERM_UI_URL);
          if (!res.ok) throw new Error(`GET / returned ${res.status}`);
          const text = await res.text();
          if (!/<\/?html/i.test(text)) throw new Error("response did not look like HTML");
        },
        "start the UI with: cd ~/projects/webterm && pnpm dev:client",
      );
    }

    const session = await step(
      "create webterm session",
      async () => createSession(),
      "the API responded but session creation failed — check server logs",
    );
    sessionId = session.id;
    infoLine(`session id = ${session.id}, ${session.cols}x${session.rows}`);

    sse = await step(
      "subscribe to SSE with promptReady=true",
      async () => subscribeSse(session.id),
      "if this 404s, you may be on an older webterm without the prompt-ready event — pull main",
    );

    const bootStart = Date.now();
    await step(
      `boot claude in ${CWD}`,
      async () => {
        if (DIRECT_SPAWN_CMD.length > 0) {
          infoLine("direct spawn: claude is the PTY child — no boot command to type");
        } else {
          infoLine(`sending: ${CLAUDE_CMD}`);
          await sendInput(session.id, CLAUDE_CMD);
        }
        infoLine(`waiting for boot prompt-ready (timeout ${BOOT_TIMEOUT_MS}ms)`);
        await waitForPromptReady(sse!, 1, BOOT_TIMEOUT_MS);
      },
      `if it times out: claude might be hitting the "trust this folder" dialog (claw-g790). Use a cwd you've opened with \`claude\` at least once.`,
    );
    infoLine(`boot completed in ${Date.now() - bootStart}ms`);

    const turnStart = Date.now();
    await step(
      `send turn: ${JSON.stringify(HEALTHCHECK_PROMPT)}`,
      async () => {
        infoLine(`waiting for turn prompt-ready (timeout ${TURN_TIMEOUT_MS}ms)`);
        // Bracketed paste + settle, same as the production handler's turn path.
        await sendInput(session.id, HEALTHCHECK_PROMPT, { kind: "paste", settleMs: PASTE_SETTLE_MS });
        await waitForPromptReady(sse!, 2, TURN_TIMEOUT_MS);
      },
      "if it times out: claude may be slow or hit a blocking prompt — check the UI (port 5173) to see the live screen",
    );
    infoLine(`turn completed in ${Date.now() - turnStart}ms`);

    const turn = await step(
      `fetch grid + extract turn (claw-etj7 retry x${ETJ7_MAX_ATTEMPTS})`,
      async () => {
        for (let attempt = 1; attempt <= ETJ7_MAX_ATTEMPTS; attempt++) {
          const grid = await fetchGridText(session.id);
          infoLine(`attempt ${attempt}: grid = ${grid.length} bytes`);
          let t = extractTurn(grid, HEALTHCHECK_PROMPT);
          // Same retry condition as the bot, but stricter on content: the
          // healthcheck needs the assistant text itself, not just tool notes.
          if (t !== null && t.assistant.trim().length > 0) {
            // Mirror the bot's render-settle confirmation: prompt-ready can
            // fire mid-render (fable thinking pauses), so re-extract until
            // two consecutive snapshots match before trusting the content.
            for (let i = 0; i < 20; i++) {
              await sleep(1_500);
              const again = extractTurn(await fetchGridText(session.id), HEALTHCHECK_PROMPT);
              if (!again) break;
              if (again.assistant === t!.assistant) return again;
              infoLine(`render still settling (snapshot grew) — re-polling`);
              t = again;
            }
            return t;
          }
          if (attempt < ETJ7_MAX_ATTEMPTS) {
            infoLine(`empty extraction (claw-etj7 premature prompt-ready?) — waiting for next prompt-ready`);
            await waitForPromptReady(sse!, 2 + attempt, 60_000);
          }
        }
        throw new Error(
          `extractor returned no assistant text after ${ETJ7_MAX_ATTEMPTS} attempts — ` +
          `claude never rendered a ⏺ block, or the TUI format drifted (gotcha #8: diff /text against test/fixtures/webterm-grids/)`,
        );
      },
    );
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
    if (sessionId !== null) {
      try {
        process.stderr.write(`[cleanup] DELETE session ${sessionId} ... `);
        await killSession(sessionId);
        process.stderr.write(`${c.green("✓")}\n`);
      } catch (err) {
        process.stderr.write(`${c.yellow("⚠")} (${err instanceof Error ? err.message : String(err)})\n`);
      }
    }
    if (sse) sse.abort.abort();
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
