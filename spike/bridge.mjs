#!/usr/bin/env node
// claw-akpn spike: drive interactive `claude` via webterm SSE.
// Throwaway — single thread, single session, in-memory state only.
//
// Modes (MODE env var):
//   stdin   - read user turns from stdin, print assistant turns to stdout (DEFAULT)
//   slack   - poll a Slack thread, post assistant replies as new messages in the thread
//
// Env config:
//   WEBTERM_URL       default http://127.0.0.1:7681
//   IDLE_MS           SSE idle window, default 1500
//   CLAUDE_CMD        default "claude"
//   COLS, ROWS        terminal dims, default 120 x 40
//   SLACK_BOT_TOKEN   required for MODE=slack
//   SLACK_CHANNEL     required for MODE=slack — channel id (Cxxx) or DM id (Dxxx)
//   SLACK_THREAD_TS   required for MODE=slack — parent message ts of the spike thread
//   SLACK_POLL_MS     default 2500
//
// Stop with Ctrl-C. Kills the webterm session before exiting.

import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const WEBTERM_URL = process.env.WEBTERM_URL ?? "http://127.0.0.1:7681";
const IDLE_MS = Number(process.env.IDLE_MS ?? 1500);
const CLAUDE_CMD = process.env.CLAUDE_CMD ?? "claude --dangerously-skip-permissions";
const COLS = Number(process.env.COLS ?? 120);
const ROWS = Number(process.env.ROWS ?? 40);
const MODE = process.env.MODE ?? "stdin";
const CWD = process.env.CWD ?? `${process.env.HOME}/projects/claudeclaw`;

const REPL_BOOT_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? 180_000);
// Grid-polling cadence for stability checks.
// Faster catches the user sooner; slower wastes fewer cycles.
const POLL_INTERVAL_MS = 400;
// Number of consecutive normalized-equal snapshots that count as "stable."
// Empirically 3 is enough; the status line timer only ticks every 1s, so
// 3 × POLL_INTERVAL_MS = 1.2s must elapse with no change beyond normalization.
const STABLE_POLL_COUNT = 3;

// strip-ansi regex (covers SGR, cursor controls, OSC titles, common DEC private modes).
// Source: github.com/chalk/ansi-regex (MIT) — inlined to keep deps zero.
const ANSI_RE = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  ].join("|"),
  "g",
);
function stripAnsi(s) {
  return s.replace(ANSI_RE, "");
}

// ----- webterm HTTP client -----

async function createSession() {
  const res = await fetch(`${WEBTERM_URL}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "claw-akpn spike",
      cols: COLS,
      rows: ROWS,
      cwd: CWD,
    }),
  });
  if (!res.ok) throw new Error(`createSession ${res.status}: ${await res.text()}`);
  return res.json();
}

async function killSession(id) {
  try {
    await fetch(`${WEBTERM_URL}/api/sessions/${id}`, { method: "DELETE" });
  } catch {}
}

async function sendText(id, text) {
  const res = await fetch(`${WEBTERM_URL}/api/sessions/${id}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "text", data: text }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`sendText ${res.status}: ${await res.text()}`);
  }
}

async function sendKeys(id, keys) {
  const res = await fetch(`${WEBTERM_URL}/api/sessions/${id}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "keys", keys }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`sendKeys ${res.status}: ${await res.text()}`);
  }
}

async function getText(id) {
  const res = await fetch(`${WEBTERM_URL}/api/sessions/${id}/text`);
  if (!res.ok) return "";
  return res.text();
}

// Normalize transient UI elements that change between snapshots even when
// claude is "idle." These break naive text-equality stability checks.
function normalizeText(text) {
  return text
    // status-line wall-clock tick: "⏱ 12s" → "⏱ Ns"
    .replace(/⏱\s*\d+s/g, "⏱ Ns")
    // session duration in animation footer: "(1s · ↓1 tokens)" → "(Ns · ↓N tokens)"
    .replace(/\(\d+s\s*·\s*[↓↑]\d+\s+tokens\)/g, "(Ns · ↓N tokens)")
    // "Cooked for 2s" / "Unravelling… 1s" etc — TUI spinner labels
    .replace(/(Cooked\s+for|Unravelling|Thinking|Pondering|Brewing)\s+\d+s/gi, "$1 Ns")
    // token meter "12k/1000k (45)" — the (45) message-count ticks per turn
    .replace(/\((\d+)\)\s*│/g, "(N) │")
    // any standalone trailing "Ns" measurement
    .replace(/\b\d+ms\b/g, "Nms");
}

// ----- SSE consumer -----
//
// Yields { event, data } objects. data is parsed JSON.
// The /events route emits:
//   event: output-chunk  data: { data: <string> }   ← yes the field is "data"
//   event: idle          data: {}
//   event: exit          data: { code: number | null }

async function* sseEvents(id) {
  const url = `${WEBTERM_URL}/api/sessions/${id}/events?idleMs=${IDLE_MS}`;
  const res = await fetch(url, { headers: { accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);

  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    // SSE record terminator is \n\n
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const rec = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of rec.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed;
      try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
      yield { event, data: parsed };
    }
  }
}

// ----- core: pump events into a turn channel -----
//
// State machine:
//   - buffer concatenates all output-chunk bytes seen
//   - "turn" is the slice of buffer since the last user input
//   - on idle, if we've sent a user turn since the last idle-flush, flush the turn

// Tracks SSE event counts so callers can wait for the Nth idle without juggling
// listener wiring. We don't buffer output-chunk bytes for content extraction —
// they're cursor-positioned TUI noise. Instead we hit /text on each idle and
// diff the rendered grid, which is what xterm-headless gives us "for free."
class IdleWatcher {
  constructor() {
    this.metrics = {
      chunks: 0,
      bytes: 0,
      idleEvents: 0,
    };
  }

  onChunk(bytes) {
    this.metrics.chunks++;
    this.metrics.bytes += bytes.length;
  }

  onIdle() {
    this.metrics.idleEvents++;
  }

  async waitForIdle() {
    const before = this.metrics.idleEvents;
    while (this.metrics.idleEvents <= before) {
      await sleep(50);
    }
  }

  // Hybrid wait: SSE idle for "claude produced something and is now paused,"
  // then polling for "screen is normalize-stable across N polls AND ❯ prompt
  // is visible."
  //
  // SSE idle alone doesn't work for turn-end detection because claude's status
  // line ticks every 1s once the REPL is up, which prevents the SSE idleMs
  // window from ever closing again. SSE idle DOES still fire reliably as a
  // "claude paused" signal between rapid output bursts during a turn.
  async waitForStableTurnEnd(sessionId, { requirePrompt, timeoutMs }) {
    const start = Date.now();
    // First, wait for SSE idle so we know claude produced AT LEAST something.
    // (We treat the SSE idle as "first burst over"; the user's input echoed,
    // claude printed its response, both happen between Enter and first idle.)
    await Promise.race([
      this.waitForIdle(),
      sleep(timeoutMs).then(() => "timeout"),
    ]);

    let stableCount = 0;
    let lastText = "";
    let lastNorm = "";
    let polls = 0;
    while (Date.now() - start < timeoutMs) {
      const text = await getText(sessionId);
      const norm = normalizeText(text);
      polls++;
      const promptOk = !requirePrompt || text.includes("❯");
      if (norm === lastNorm && promptOk) {
        stableCount++;
        if (stableCount >= STABLE_POLL_COUNT) {
          return { text, polls, elapsedMs: Date.now() - start, timedOut: false };
        }
      } else {
        stableCount = promptOk ? 1 : 0;
        lastNorm = norm;
      }
      lastText = text;
      await sleep(POLL_INTERVAL_MS);
    }
    return { text: lastText, polls, elapsedMs: Date.now() - start, timedOut: true };
  }
}

// ----- output extraction from grid text -----
//
// claude's TUI is column-positioned, so ANSI-stripped output bytes are
// unreadable (words run together). The /text endpoint returns the rendered
// grid — clean, but it includes UI chrome (status line, prompt box, banner)
// we need to drop.
//
// claude's response messages all start with "⏺ " at column 0. We slice from
// the LAST "⏺ " line to the end of the assistant region, then drop chrome.
//
// Returns null if we can't find an assistant turn (e.g. claude is still
// thinking or no response yet).

const CHROME_LINE_PATTERNS = [
  /^\s*$/,                          // blank
  /^\s*─+\s*$/,                     // horizontal rules
  /^[│|].*[│|]\s*$/,                // box-drawn rows
  /^\s*❯\s*$/,                      // empty input prompt
  /^\s*❯\s/,                        // input prompt with content
  /^\s*[●○]\s/,                     // mode indicators
  /^\s*[✻✶✳✢✽⠂⠐⠈⠁]\s+[A-Za-z]+(ing|ed)\s+for\s+\d+s/,        // any spinner verb "Xed/Xing for Ns"
  /^\s*[✻✶✳✢✽⠂⠐⠈⠁]\s+[A-Za-z]+ing…/,                          // "Unravelling…" style still-thinking
  /^\s*⏵⏵/,                         // permissions footer
  /^\s*Opus\s+\d/,                  // status line model name
  /\(shift\+tab/,                   // permissions hint
  /^\s*no\s?git\s*│/,               // git/cwd status row (no git)
  /^\s*(main|master|HEAD)\s*[●◆◇]?\s*│/,  // git branch status row
  /^\s*🧠\s+/,                      // memory ribbon
  /^\s*\d+\.\d+k?\s*│/,             // token meter standalone
  /^\s*Try\s"/,                     // "Try ..." suggestion
  /^\s*Tip[s:]/,                    // tips
  /[█▌▐▘▝▛▜▟▙▞▖▗▕▏▒░▓]/,            // logo glyphs
  /Welcome\sback/,
  /Run\s\/init/,
  /Introducing/,
  /Fixed an issue/,
  /^\s*release-notes/,
];

function isChrome(line) {
  return CHROME_LINE_PATTERNS.some((re) => re.test(line));
}

function extractAssistantTurn(text, userTurnText) {
  const lines = text.split("\n");
  // Find the LAST occurrence of "⏺ " line (most recent assistant message).
  let startIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trimStart().startsWith("⏺ ")) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  // From startIdx to end of visible region — but drop chrome and trailing blanks.
  const taken = [];
  for (let i = startIdx; i < lines.length; i++) {
    let line = lines[i];
    if (i === startIdx) {
      // strip the "⏺ " prefix from the first line
      line = line.replace(/^\s*⏺\s/, "");
    }
    if (isChrome(line)) continue;
    taken.push(line);
  }
  // Trim trailing blanks
  while (taken.length && !taken[taken.length - 1].trim()) taken.pop();
  return taken.join("\n");
}

// ----- Slack helpers (only loaded in slack mode) -----

async function loadSlack() {
  const { WebClient } = await import("@slack/web-api");
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("MODE=slack requires SLACK_BOT_TOKEN");
  const channel = process.env.SLACK_CHANNEL;
  if (!channel) throw new Error("MODE=slack requires SLACK_CHANNEL");
  const threadTs = process.env.SLACK_THREAD_TS;
  if (!threadTs) throw new Error("MODE=slack requires SLACK_THREAD_TS");
  return {
    client: new WebClient(token),
    channel,
    threadTs,
    pollMs: Number(process.env.SLACK_POLL_MS ?? 2500),
  };
}

async function pollSlackForUserTurn(slack, sinceTs) {
  // Returns { text, ts } for the next new user message in the thread, or null.
  const res = await slack.client.conversations.replies({
    channel: slack.channel,
    ts: slack.threadTs,
    oldest: sinceTs,
    inclusive: false,
    limit: 50,
  });
  const msgs = res.messages ?? [];
  for (const m of msgs) {
    if (!m.text) continue;
    if (m.bot_id) continue;            // skip our own bot replies
    if (m.subtype === "bot_message") continue;
    if (m.ts === slack.threadTs) continue;  // skip the parent
    if (Number(m.ts) <= Number(sinceTs)) continue;
    return { text: m.text, ts: m.ts };
  }
  return null;
}

async function postSlackReply(slack, text) {
  // Truncate to ~3500 chars; Slack hard limit is ~4000 but we want safety.
  let body = text || "_(no text response)_";
  if (body.length > 3500) body = body.slice(0, 3500) + "\n…(truncated)";
  await slack.client.chat.postMessage({
    channel: slack.channel,
    thread_ts: slack.threadTs,
    text: body,
    mrkdwn: true,
  });
}

// ----- main loop -----

async function main() {
  console.error(`[spike] mode=${MODE} webterm=${WEBTERM_URL} idleMs=${IDLE_MS}`);
  const session = await createSession();
  console.error(`[spike] session ${session.id} (${session.cols}x${session.rows})`);

  let sigCount = 0;
  let shuttingDown = false;
  const shutdown = async (signal) => {
    sigCount++;
    if (sigCount > 1) process.exit(1);
    shuttingDown = true;
    console.error(`[spike] ${signal} received, killing session ${session.id}`);
    await killSession(session.id);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const watcher = new IdleWatcher();

  // SSE in background
  (async () => {
    try {
      for await (const ev of sseEvents(session.id)) {
        if (ev.event === "output-chunk") watcher.onChunk(ev.data.data ?? "");
        else if (ev.event === "idle") watcher.onIdle();
        else if (ev.event === "exit") {
          console.error(`[spike] webterm session exited code=${ev.data.code}`);
          if (!shuttingDown) process.exit(1);
        }
      }
    } catch (err) {
      if (!shuttingDown) {
        console.error(`[spike] SSE stream error:`, err.message);
        process.exit(1);
      }
    }
  })();

  // boot claude
  const bootStart = Date.now();
  await sendText(session.id, CLAUDE_CMD);
  await sendKeys(session.id, ["Enter"]);
  console.error(`[spike] sent "${CLAUDE_CMD}\\n", waiting for REPL boot in cwd=${CWD}...`);

  // Wait for the REPL to settle. Hybrid: SSE idle for first activity, then
  // grid polling for stability.
  const bootResult = await watcher.waitForStableTurnEnd(session.id, {
    requirePrompt: true,
    timeoutMs: REPL_BOOT_TIMEOUT_MS,
  });
  if (bootResult.timedOut) {
    console.error(`[spike] REPL boot timed out after ${REPL_BOOT_TIMEOUT_MS}ms`);
    console.error(`[spike] last screen:\n${bootResult.text}`);
    await shutdown("BOOT_TIMEOUT");
    return;
  }
  console.error(`[spike] REPL ready in ${Date.now() - bootStart}ms (idles=${watcher.metrics.idleEvents}, polls=${bootResult.polls})`);

  // Driver loop
  if (MODE === "stdin") {
    await runStdin(session.id, watcher);
  } else if (MODE === "slack") {
    await runSlack(session.id, watcher);
  } else {
    console.error(`[spike] unknown MODE=${MODE}`);
    await shutdown("BAD_MODE");
  }
}

async function takeTurn(sessionId, watcher, userText) {
  const turnStart = Date.now();
  const idleBefore = watcher.metrics.idleEvents;
  await sendText(sessionId, userText);
  await sendKeys(sessionId, ["Enter"]);
  const r = await watcher.waitForStableTurnEnd(sessionId, {
    requirePrompt: true,
    timeoutMs: TURN_TIMEOUT_MS,
  });
  const reply = extractAssistantTurn(r.text, userText);
  return {
    reply,
    finalText: r.text,
    polls: r.polls,
    elapsedMs: r.elapsedMs,
    totalMs: Date.now() - turnStart,
    idles: watcher.metrics.idleEvents - idleBefore,
    timedOut: r.timedOut,
  };
}

async function runStdin(sessionId, watcher) {
  const rl = createInterface({ input, output, terminal: false });
  console.error(`[spike] stdin mode — type your prompts and hit Enter. Ctrl-C / EOF to stop.`);
  output.write("> ");
  for await (const line of rl) {
    if (!line.trim()) { output.write("> "); continue; }
    const r = await takeTurn(sessionId, watcher, line);
    output.write(`\n--- assistant (${r.totalMs}ms total, ${r.polls} polls, ${r.idles} idles${r.timedOut ? ", TIMEOUT" : ""}) ---\n`);
    output.write((r.reply ?? "_(no assistant turn detected)_") + "\n");
    output.write(`--- cum metrics: chunks=${watcher.metrics.chunks} bytes=${watcher.metrics.bytes} idles=${watcher.metrics.idleEvents} ---\n`);
    output.write("> ");
  }
  console.error(`[spike] stdin closed, killing session ${sessionId}`);
  await killSession(sessionId);
  process.exit(0);
}

async function runSlack(sessionId, watcher) {
  const slack = await loadSlack();
  console.error(`[spike] slack mode — channel=${slack.channel} thread=${slack.threadTs} pollMs=${slack.pollMs}`);
  let cursorTs = slack.threadTs;
  let turnCount = 0;

  for (;;) {
    const next = await pollSlackForUserTurn(slack, cursorTs);
    if (!next) {
      await sleep(slack.pollMs);
      continue;
    }
    cursorTs = next.ts;
    turnCount++;
    console.error(`[spike] turn ${turnCount}: user ts=${next.ts} text=${JSON.stringify(next.text.slice(0, 80))}`);

    const r = await takeTurn(sessionId, watcher, next.text);
    console.error(`[spike] turn ${turnCount} done in ${r.totalMs}ms; reply=${(r.reply?.length ?? 0)}b polls=${r.polls} idles=${r.idles}${r.timedOut ? " TIMEOUT" : ""}`);
    await postSlackReply(slack, r.reply ?? "_(no assistant turn detected)_");
  }
}

main().catch((err) => {
  console.error(`[spike] fatal:`, err);
  process.exit(1);
});
