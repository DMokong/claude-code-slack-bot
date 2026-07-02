import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractTurn, formatTurnForSlack, extractActivity, extractSegments, isGridIdle } from "./webterm-claude-extractor";

const FIXTURE_DIR = join(__dirname, "..", "test", "fixtures", "webterm-grids");

interface Fixture {
  name: string;
  userInput: string;
  grid: string;
  scrollback: string;
}

function loadFixture(name: string): Fixture {
  const raw = readFileSync(join(FIXTURE_DIR, `${name}.txt`), "utf-8");
  const userInputMarker = "__USER_INPUT__\n";
  const gridMarker = "\n__GRID__\n";
  const scrollbackMarker = "\n__SCROLLBACK__\n";
  const userInputStart = raw.indexOf(userInputMarker) + userInputMarker.length;
  const gridStart = raw.indexOf(gridMarker);
  const scrollbackStart = raw.indexOf(scrollbackMarker);
  return {
    name,
    userInput: raw.slice(userInputStart, gridStart),
    grid: raw.slice(gridStart + gridMarker.length, scrollbackStart),
    scrollback: raw.slice(scrollbackStart + scrollbackMarker.length),
  };
}

describe("extractTurn — real claude grid fixtures", () => {
  it("01-short-math: extracts single-sentence response", () => {
    const f = loadFixture("01-short-math");
    const turn = extractTurn(f.grid, f.userInput);
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toBe("2 plus 2 equals 4.");
    expect(turn!.toolNotes).toEqual([]);
  });

  it("04-tool-read: unwraps a word-wrapped 3-line response", () => {
    const f = loadFixture("04-tool-read");
    const turn = extractTurn(f.grid, f.userInput);
    expect(turn).not.toBeNull();
    // The wrapped sentence becomes one line.
    expect(turn!.assistant).toBe(
      "Cindy Clawdford is the personal AI agent persona of the ClaudeClaw workspace — an enthusiastic, proactive co-pilot (with a personality defined in SOUL.md) who coordinates Claude Code, Cowork, Claude Chat, and OpenClaw into a unified personal assistant system for Dustin Cheng.",
    );
    expect(turn!.toolNotes).toEqual([]);
  });

  it("05-emoji-reply: preserves emoji content", () => {
    const f = loadFixture("05-emoji-reply");
    const turn = extractTurn(f.grid, f.userInput);
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toContain("Goodbye, Dustin!");
    expect(turn!.assistant).toContain("🐾");
    expect(turn!.toolNotes).toEqual([]);
  });

  it("06-multistep: captures tool-use notes + assistant response separately", () => {
    const f = loadFixture("06-multistep");
    const turn = extractTurn(f.grid, f.userInput);
    expect(turn).not.toBeNull();
    expect(turn!.toolNotes.length).toBeGreaterThan(0);
    expect(turn!.toolNotes.join("\n")).toContain("Searched for");
    expect(turn!.assistant).toContain("Environment");
    expect(turn!.assistant).toContain("third top-level section");
    // The 3-line wrapped sentence collapsed to one.
    expect(turn!.assistant.split("\n")).toHaveLength(1);
  });

  it("returns null when the grid doesn't contain the user input", () => {
    const f = loadFixture("01-short-math");
    const turn = extractTurn(f.grid, "this input was never sent");
    expect(turn).toBeNull();
  });

  it("never leaks chrome (spinner, status line, prompt box) into assistant", () => {
    for (const name of readdirSync(FIXTURE_DIR)) {
      if (!name.endsWith(".txt")) continue;
      const f = loadFixture(name.replace(".txt", ""));
      const turn = extractTurn(f.grid, f.userInput);
      if (!turn) continue;
      expect(turn.assistant).not.toMatch(/✻.*for\s+\d+s/);
      expect(turn.assistant).not.toMatch(/Opus\s+\d/);
      expect(turn.assistant).not.toMatch(/Fable\s+\d/);
      expect(turn.assistant).not.toMatch(/⏵⏵/);
      expect(turn.assistant).not.toMatch(/─{4,}/);
    }
  });
});

describe("extractTurn — Fable-era TUI (claude v2.1.173, bracketed-paste input)", () => {
  it("fable-multiline-paste-turn: finds the multi-line paste echo and extracts the response", () => {
    const f = loadFixture("fable-multiline-paste-turn");
    const turn = extractTurn(f.grid, f.userInput);
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toBe("PROBE-OK");
    expect(turn!.toolNotes).toEqual([]);
  });

  it("fable-large-paste-spinner: mid-turn grid (no ⏺ yet) extracts empty and retryable, spinner filtered", () => {
    const f = loadFixture("fable-large-paste-spinner");
    const turn = extractTurn(f.grid, f.userInput);
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toBe("");
    expect(turn!.toolNotes).toEqual([]);
  });

  it("filters the '·'-glyph spinner frame as chrome (leaked into toolNotes in 2026-06-11 healthcheck)", () => {
    const grid = [
      "❯ what is 2 plus 2? answer in one short sentence.",
      "",
      "· Frolicking…",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
    ].join("\n");
    const turn = extractTurn(grid, "what is 2 plus 2? answer in one short sentence.");
    expect(turn).not.toBeNull();
    expect(turn!.toolNotes).toEqual([]);
    expect(turn!.assistant).toBe("");
  });

  it("fable-code-block-response: preserves intentional code newlines (H4 — does NOT flatten)", () => {
    const f = loadFixture("fable-code-block-response");
    const turn = extractTurn(f.grid, f.userInput);
    expect(turn).not.toBeNull();
    // The two code lines must stay on separate lines, not be word-wrap-joined.
    const lines = turn!.assistant.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(turn!.assistant).toContain("def add(a, b):");
    expect(turn!.assistant).toMatch(/def add\(a, b\):\n/);
    expect(turn!.assistant).not.toMatch(/def add\(a, b\): +return/);
  });

  it("still joins genuinely word-wrapped prose (04 regression with the H4 width heuristic)", () => {
    const f = loadFixture("04-tool-read");
    const turn = extractTurn(f.grid, f.userInput);
    expect(turn).not.toBeNull();
    // The wrapped sentence is still collapsed to one line.
    expect(turn!.assistant.split("\n")).toHaveLength(1);
  });

  it("filters the Fable model status row as chrome when no bottom prompt bounds the region", () => {
    const grid = [
      "❯ hi",
      "",
      "⏺ hello there",
      "",
      "   Fable 5 │ ░░░░░░░░░░ 0%/1000k (0) │ $0.00 │ ⏱ 2s",
    ].join("\n");
    const turn = extractTurn(grid, "hi");
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toBe("hello there");
  });
});

describe("extractTurn — bottom-prompt boundary + model-row chrome (Sonnet-era leak, 2026-06-12)", () => {
  // Live repro: claude showed a contextual input suggestion ("list them out")
  // inside the bottom prompt box, so the box wasn't an isolated "❯". The
  // boundary detector over-extended and the prompt line + "Sonnet 4.6 …"
  // status row leaked into the delivered answer.
  const grid = [
    "❯ run ls and count the entries",
    "",
    "⏺ 39 entries in /Users/dustincheng/projects/claudeclaw.",
    "",
    "✻ Bunning…",
    "────────────────────────────────────────────────────────────",
    "❯ list them out",
    "────────────────────────────────────────────────────────────",
    "   Sonnet 4.6 │ ████░░░░░░ 24%/200k (1) │ $0.21 │ ⏱ 14s",
    "   main ● │ ~/projects/claudeclaw │ v2.1.173",
  ].join("\n");

  it("does not leak the ghost-text input box into the answer", () => {
    const turn = extractTurn(grid, "run ls and count the entries");
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toBe("39 entries in /Users/dustincheng/projects/claudeclaw.");
    expect(turn!.assistant).not.toContain("list them out");
    expect(turn!.assistant).not.toContain("Sonnet 4.6");
  });

  it("stops the answer at the footer — excludes the new '※ recap' block (live 2026-06-12)", () => {
    const NBSP = " ";
    const g = [
      "❯ count to 10 then give me a joke",
      "",
      "⏺ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ✅",
      "",
      "  Why did the developer quit their job?",
      "",
      "  Because they didn't get arrays. 🥁",
      "",
      "✻ Crunched for 2s",
      "",
      "※ recap: We've just been exchanging casual greetings and jokes — no active work in progress. Pick up whenever you're",
      "  ready! (disable recaps in /config)",
      "",
      "────────────────────────────────────────────────────────────",
      `❯${NBSP}another joke`,
      "────────────────────────────────────────────────────────────",
      "   Sonnet 4.6 │ 26%/200k (3) │ $0.43 │ ⏱ 5h13m",
    ].join("\n");
    const turn = extractTurn(g, "count to 10 then give me a joke");
    expect(turn!.assistant).toContain("Because they didn't get arrays. 🥁");
    expect(turn!.assistant).not.toContain("recap");
    expect(turn!.assistant).not.toContain("another joke");
    expect(turn!.assistant).not.toContain("❯");
    expect(turn!.assistant).not.toContain("Sonnet");
  });

  it("does not truncate assistant content that follows a ※ tip line (claw-gxzq)", () => {
    const grid = [
      "[webterm:test] user@host claudeclaw %",
      "",
      "❯ do the thing",
      "",
      "⏺ Starting the first part of the work.",
      "",
      "※ Tip: Send a message while Claude works to steer it.",
      "",
      "⏺ And here is the second part after the tip.",
      "",
      "✻ Cooked for 2s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 (1M context) │ ⏱ 5s",
    ].join("\n");
    const turn = extractTurn(grid, "do the thing");
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toContain("first part");
    expect(turn!.assistant).toContain("second part after the tip");
    expect(turn!.assistant).not.toContain("Tip:");
  });

  it("drops a ※ tip rendered BEFORE the first ⏺ block as chrome (claw-gxzq)", () => {
    // Regression guard for the final-review finding: isAnswerEnd is no longer
    // gated by having seen a ⏺ marker, so a ※ tip that renders BEFORE the first
    // answer block enters chrome mode (skipped) rather than leaking into
    // toolNotes (the pre-fix mode==="none" path would have pushed it). The real
    // ⏺ answer that follows the tip is still captured.
    const grid = [
      "[webterm:test] user@host claudeclaw %",
      "",
      "❯ do the thing",
      "",
      "※ Tip: Send a message while Claude works to steer it.",
      "",
      "⏺ The real answer arrives after the tip.",
      "",
      "✻ Cooked for 2s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 (1M context) │ ⏱ 5s",
    ].join("\n");
    const turn = extractTurn(grid, "do the thing");
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toContain("real answer arrives after the tip");
    expect(turn!.assistant).not.toContain("Tip:");
    expect(turn!.toolNotes).toEqual([]);
  });

  it("handles a ghost suggestion that wraps onto multiple box lines", () => {
    const g = [
      "❯ summarize the repo",
      "",
      "⏺ It's a personal AI agent workspace.",
      "",
      "✻ Cogitated for 9s",
      "────────────────────────────────────────────────────────────",
      "❯ now run it in the real bot and confirm it works end to end with a much longer",
      "  suggestion that wrapped onto a second line inside the box",
      "────────────────────────────────────────────────────────────",
      "   Sonnet 4.6 │ 24%/200k │ $0.20 │ ⏱ 9s",
      "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
    ].join("\n");
    const turn = extractTurn(g, "summarize the repo");
    expect(turn!.assistant).toBe("It's a personal AI agent workspace.");
    expect(turn!.assistant).not.toContain("now run it");
    expect(turn!.assistant).not.toContain("wrapped onto");
  });

  it("hard-stops at the input box even mid-render (no footer rules/model row yet)", () => {
    // Backstop: claude's dynamic input suggestion appeared before the footer
    // rules/status row rendered, so findFooterStart can't anchor. The prompt
    // marker itself must end the answer.
    const g = [
      "❯ count files",
      "",
      "⏺ There are 39 entries in the current directory.",
      "",
      "❯ push this",
    ].join("\n");
    const turn = extractTurn(g, "count files");
    expect(turn!.assistant).toBe("There are 39 entries in the current directory.");
    expect(turn!.assistant).not.toContain("push this");
  });

  it("hard-stops on the NON-BREAKING space the box actually uses (live root cause)", () => {
    const NBSP = " ";
    // claude renders "❯ <suggestion>", not "❯ <suggestion>" — this is what
    // leaked 'list them out' / 'now run it' / 'push this' into live answers.
    const g = [
      "❯ count files",
      "",
      "⏺ There are 39 entries in the current directory.",
      "",
      `❯${NBSP}what files are untracked`,
    ].join("\n");
    const turn = extractTurn(g, "count files");
    expect(turn!.assistant).toBe("There are 39 entries in the current directory.");
    expect(turn!.assistant).not.toContain("what files are untracked");
    expect(turn!.assistant).not.toContain("❯");
  });

  it("hard-stops at an empty input box (isolated ❯) mid-render", () => {
    const g = ["❯ hi", "", "⏺ hello world", "", "❯"].join("\n");
    expect(extractTurn(g, "hi")!.assistant).toBe("hello world");
  });

  it("filters the Sonnet/Haiku model status row as chrome", () => {
    const g = ["❯ hi", "", "⏺ hello", "", "   Sonnet 4.6 │ 24%/200k │ $0.21 │ ⏱ 2s"].join("\n");
    expect(extractTurn(g, "hi")!.assistant).toBe("hello");
    const h = ["❯ hi", "", "⏺ hello", "", "   Haiku 4.5 │ 1%/200k │ $0.00 │ ⏱ 1s"].join("\n");
    expect(extractTurn(h, "hi")!.assistant).toBe("hello");
  });
});

describe("extractTurn — multi-paragraph user echo (blank-line separator, claw-dfcm)", () => {
  // webterm right-trims grid rows, so a blank paragraph separator inside a
  // multi-line pasted message echoes as "" — which doesn't start with the
  // echo indent. findEchoEnd used to break there, leaving paragraph 2+ in the
  // turn region as fake toolNotes. Two failure modes:
  //   (a) answered turn → the user's own paragraph 2 gets italicized in front
  //       of the real answer.
  //   (b) premature prompt-ready → the fake toolNotes make haveContent true,
  //       so the bot posts the user's paragraph as "the answer" and the retry
  //       guard (claw-etj7) is defeated, dropping the real answer.

  it("mode (a): does not leak a multi-paragraph echo into the answer", () => {
    const userInput =
      "Here is the first paragraph of my question.\n\nHere is the second paragraph with more detail.";
    const grid = [
      "❯ Here is the first paragraph of my question.",
      "",
      "  Here is the second paragraph with more detail.",
      "",
      "⏺ Here is my answer to both paragraphs.",
      "",
      "✻ Cooked for 2s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ 5%/200k │ $0.10 │ ⏱ 3s",
    ].join("\n");
    const turn = extractTurn(grid, userInput);
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toBe("Here is my answer to both paragraphs.");
    expect(turn!.toolNotes).toEqual([]);
    expect(turn!.assistant).not.toContain("second paragraph");
  });

  it("mode (b): a premature prompt-ready with no ⏺ block stays empty + retryable", () => {
    const userInput =
      "First paragraph of the question here.\n\nSecond paragraph continues the thought.";
    const grid = [
      "❯ First paragraph of the question here.",
      "",
      "  Second paragraph continues the thought.",
      "",
      "✻ Pondering…",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ 2%/200k │ $0.01 │ ⏱ 1s",
    ].join("\n");
    const turn = extractTurn(grid, userInput);
    expect(turn).not.toBeNull();
    // No real answer yet → both empty → haveContent is false → bot retries.
    expect(turn!.assistant).toBe("");
    expect(turn!.toolNotes).toEqual([]);
  });

  it("still captures genuine tool notes that precede the ⏺ block", () => {
    // A real tool note (not echo) must still land in toolNotes — the fix must
    // not over-consume past the echo into pre-answer tool indicators.
    const userInput = "First paragraph.\n\nSecond paragraph.";
    const grid = [
      "❯ First paragraph.",
      "",
      "  Second paragraph.",
      "",
      "  Searched for 2 patterns (ctrl+o to expand)",
      "",
      "⏺ Found it in the config.",
      "",
      "✻ Cooked for 1s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ 5%/200k │ $0.10 │ ⏱ 2s",
    ].join("\n");
    const turn = extractTurn(grid, userInput);
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toBe("Found it in the config.");
    expect(turn!.toolNotes).toEqual(["Searched for 2 patterns (ctrl+o to expand)"]);
  });
});

describe("extractTurn — interleaved tool blocks (narrate→tool→conclude, claw-v3do)", () => {
  // Modern claude (v2.1.173+) renders tool CALLS as their own "⏺ Tool(args)"
  // block with a "⎿ result" summary row, interleaved with prose "⏺ …" blocks.
  // The old extractor flipped inAssistant once at the first ⏺ and never reset,
  // so the tool call + its ⎿ summary got glued into the assistant prose.
  // buildBootCmd's "plain prose" instruction makes narration (and thus this
  // shape) more likely.

  it("keeps tool calls out of the prose and in toolNotes", () => {
    const grid = [
      "❯ check the config and tell me the port",
      "",
      "⏺ Let me look that up.",
      "",
      "⏺ Grep(port.*=)",
      "  ⎿ Found 2 matches in config.ts",
      "",
      "⏺ The port is 7681, set in config.ts.",
      "",
      "✻ Cooked for 3s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ 5%/200k │ $0.10 │ ⏱ 3s",
    ].join("\n");
    const turn = extractTurn(grid, "check the config and tell me the port");
    expect(turn).not.toBeNull();
    // Both prose blocks survive…
    expect(turn!.assistant).toContain("Let me look that up.");
    expect(turn!.assistant).toContain("The port is 7681, set in config.ts.");
    // …and the tool call + its result are NOT glued into the answer.
    expect(turn!.assistant).not.toContain("Grep(");
    expect(turn!.assistant).not.toContain("Found 2 matches");
    expect(turn!.assistant).not.toContain("⎿");
    // The tool call is captured as a tool note.
    expect(turn!.toolNotes.some((n) => /Grep\(/.test(n))).toBe(true);
  });

  it("classifies a single ⏺ Tool(args) block with no prose as toolNotes only", () => {
    const grid = [
      "❯ run the tests",
      "",
      "⏺ Bash(npm test)",
      "  ⎿ 169 passing",
      "",
      "✻ Cooked for 8s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ 5%/200k │ $0.10 │ ⏱ 9s",
    ].join("\n");
    const turn = extractTurn(grid, "run the tests");
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toBe("");
    expect(turn!.toolNotes.some((n) => /Bash\(npm test\)/.test(n))).toBe(true);
  });

  it("does not misclassify prose that merely contains parentheses as a tool call", () => {
    const grid = [
      "❯ summarize",
      "",
      "⏺ The third section (Environment) documents the setup.",
      "",
      "✻ Cooked for 1s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ 5%/200k │ $0.10 │ ⏱ 2s",
    ].join("\n");
    const turn = extractTurn(grid, "summarize");
    expect(turn).not.toBeNull();
    expect(turn!.assistant).toBe("The third section (Environment) documents the setup.");
    expect(turn!.toolNotes).toEqual([]);
  });
});

describe("extractActivity — live turn status", () => {
  it("reports a spinner with elapsed seconds as 'thinking'", () => {
    const grid = ["❯ hi", "", "✻ Crunched for 7s", "", "──────", "❯", "──────"].join("\n");
    expect(extractActivity(grid)).toBe("✻ thinking… (7s)");
  });

  it("reports a whimsical spinner verb as-is", () => {
    const grid = ["❯ hi", "", "✶ Pouncing…", "──────"].join("\n");
    expect(extractActivity(grid)).toBe("✻ Pouncing…");
  });

  it("reports the '·'-glyph spinner too", () => {
    const grid = ["❯ hi", "", "· Frolicking…"].join("\n");
    expect(extractActivity(grid)).toBe("✻ Frolicking…");
  });

  it("prefers tool activity over the spinner, with a friendly label", () => {
    const grid = ["❯ list files", "", "⏺ Bash(ls -la)", "  ⎿ running", "✻ Crunched for 2s"].join("\n");
    expect(extractActivity(grid)).toBe("🔧 running a command…");
  });

  it("maps known tools to labels and falls back for unknown ones", () => {
    expect(extractActivity("⏺ Read(/etc/hosts)")).toBe("📖 reading a file…");
    expect(extractActivity("⏺ Grep(pattern)")).toBe("🔎 searching the code…");
    expect(extractActivity("⏺ Frobnicate(x)")).toBe("🔧 Frobnicate…");
  });

  it("reports the LAST (most recent) tool when several appear", () => {
    const grid = ["⏺ Read(a)", "⏺ Bash(b)"].join("\n");
    expect(extractActivity(grid)).toBe("🔧 running a command…");
  });

  it("returns null when there's no recognizable activity", () => {
    expect(extractActivity(["❯ hi", "", "──────", "❯", "──────"].join("\n"))).toBeNull();
  });

  it("does not treat an assistant ⏺ prose block as a tool", () => {
    const grid = ["❯ hi", "", "⏺ Here is your answer about things.", "──────"].join("\n");
    expect(extractActivity(grid)).toBeNull();
  });
});

describe("formatTurnForSlack", () => {
  it("renders tool notes as italic prefix, assistant body as plain", () => {
    const out = formatTurnForSlack({
      assistant: "The answer is 42.",
      toolNotes: ["Searched for 1 pattern"],
    });
    expect(out).toBe("_Searched for 1 pattern_\n\nThe answer is 42.");
  });

  it("emits just the assistant body when there are no tool notes", () => {
    expect(formatTurnForSlack({ assistant: "hi", toolNotes: [] })).toBe("hi");
  });

  it("emits empty string when the turn has no content", () => {
    expect(formatTurnForSlack({ assistant: "", toolNotes: [] })).toBe("");
  });
});

describe("extractSegments", () => {
  it("returns prose and tool blocks in render order, tips filtered", () => {
    const grid = [
      "[webterm:test] user@host claudeclaw %",
      "",
      "❯ build it",
      "",
      "⏺ First, here's the plan.",
      "",
      "⏺ Bash(npm run build)",
      "  ⎿ build ok",
      "",
      "※ Tip: steer me anytime.",
      "",
      "⏺ Done — build is green.",
      "",
      "✻ Cooked for 9s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 (1M context) │ ⏱ 9s",
    ].join("\n");
    const segs = extractSegments(grid, "build it");
    expect(segs.map((s) => s.kind)).toEqual(["prose", "tool", "prose"]);
    expect(segs[0].text).toContain("here's the plan");
    expect(segs[1].text).toContain("Bash(npm run build)");
    expect(segs[2].text).toContain("build is green");
    expect(segs.some((s) => s.text.includes("Tip:"))).toBe(false);
  });

  it("returns [] when the user echo is not present", () => {
    expect(extractSegments("no echo here", "missing")).toEqual([]);
  });
});

describe("isGridIdle", () => {
  it("is true at a bare prompt with no active spinner", () => {
    const grid = [
      "⏺ all done.",
      "",
      "✻ Cooked for 3s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Opus 4.8 (1M context) │ ⏱ 3s",
    ].join("\n");
    expect(isGridIdle(grid)).toBe(true);
  });

  it("is false while an active spinner is present (claude working)", () => {
    const grid = [
      "❯ count to 45",
      "",
      "✻ Tinkering…",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ ⏱ 1s",
    ].join("\n");
    expect(isGridIdle(grid)).toBe(false);
  });

  it("is false when there is no input box (bare shell)", () => {
    expect(isGridIdle("[webterm:test] user@host claudeclaw %")).toBe(false);
  });

  // claw-gxzq live-verification bug (2026-07-03): claude's REAL active spinner
  // renders the verb+ellipsis followed by a live "(Ns · N tokens · thought…)"
  // suffix. The end-anchored spinner regex only matched a BARE "Verb…", so a
  // mid-generation grid read as idle → the relay finalized the Slack message at
  // ~7s with only the streaming placeholder while claude was still working. The
  // ❯ input box is always drawn during generation, so the prompt alone is not a
  // turn-end signal.
  it("is false during generation when the spinner carries a token-count suffix", () => {
    const grid = [
      "❯ tell me a fun fact",
      "",
      "✻ Whirring… (7s · ↓ 154 tokens · thought for 1s)",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ ⏱ 7s",
    ].join("\n");
    expect(isGridIdle(grid)).toBe(false);
  });

  it("is true at a completed 'Churned for Ns' status line (past-tense, no ellipsis)", () => {
    const grid = [
      "⏺ 4",
      "",
      "✻ Churned for 16s",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ ⏱ 22s",
    ].join("\n");
    expect(isGridIdle(grid)).toBe(true);
  });
});

// claw-gxzq trailing-body drop (2026-07-03). Frames captured at 200ms from a
// live 3-step turn show claude REMOVES the spinner line while it streams prose
// into the transcript — so a mid-render grid satisfies isGridIdle (prompt box
// is always drawn, no spinner present) while the trailing ⏺ block is only its
// header. These fixtures pin that reality: the extractor CANNOT distinguish a
// transient render pause from real idle on a single frame, so the relay must
// gate finalization on idle STABILITY, not one idle observation.
describe("idle-flap fixtures — mid-render grids that look idle (claw-gxzq)", () => {
  it("08-2: header-only mid-render frame reads idle with a header-only trailing segment", () => {
    const f = loadFixture("08-stream-flap-2-poison-header");
    expect(isGridIdle(f.grid)).toBe(true);
    const segs = extractSegments(f.grid, f.userInput);
    expect(segs.length).toBe(1);
    expect(segs[0].kind).toBe("prose");
    expect(segs[0].text).toContain("Step 1 — Octopus fun fact:");
    expect(segs[0].text).not.toContain("hearts");
  });

  it("08-3: 500ms later the same block has grown a body on an equally idle-looking frame", () => {
    const f = loadFixture("08-stream-flap-3-body");
    expect(isGridIdle(f.grid)).toBe(true);
    const segs = extractSegments(f.grid, f.userInput);
    expect(segs[segs.length - 1].text).toContain("hearts");
  });

  it("09: the turn-end pair shows the haiku body arriving AFTER an idle-looking header frame", () => {
    const header = loadFixture("09-turnend-flap-1-header");
    const body = loadFixture("09-turnend-flap-2-body");
    expect(isGridIdle(header.grid)).toBe(true);
    expect(isGridIdle(body.grid)).toBe(true);
    const headerSegs = extractSegments(header.grid, header.userInput);
    const bodySegs = extractSegments(body.grid, body.userInput);
    expect(headerSegs[headerSegs.length - 1].text).toContain("Terminal haiku:");
    expect(headerSegs[headerSegs.length - 1].text).not.toContain("Cursor blinks");
    expect(bodySegs[bodySegs.length - 1].text).toContain("Cursor blinks");
  });
});

describe("suffixed live spinner is chrome, not prose (claw-gxzq)", () => {
  // Same EOL-anchor bug family as isGridIdle's ACTIVE_SPINNER_RE: the chrome
  // filter only recognized a BARE "✻ Verb…" spinner, so the real suffixed form
  // ("✳ Nesting… (5s · ↓ 205 tokens)") leaked into extracted prose segments.
  it("10: excludes a '✳ Nesting… (5s · ↓ 205 tokens)' line from prose segments", () => {
    const f = loadFixture("10-spinner-suffix-leak");
    const segs = extractSegments(f.grid, f.userInput);
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) {
      expect(s.text).not.toContain("Nesting…");
    }
  });

  it("filters a suffixed spinner between prose blocks in a synthetic grid", () => {
    const grid = [
      "[webterm:test] user@host claudeclaw %",
      "",
      "❯ build it",
      "",
      "⏺ First, here's the plan.",
      "",
      "✳ Nesting… (5s · ↓ 205 tokens)",
      "",
      "────────────────────────────────────────",
      "❯",
      "────────────────────────────────────────",
      "   Sonnet 4.6 │ ⏱ 5s",
    ].join("\n");
    const segs = extractSegments(grid, "build it");
    expect(segs.map((s) => s.kind)).toEqual(["prose"]);
    expect(segs[0].text).toContain("here's the plan");
    expect(segs.some((s) => s.text.includes("Nesting"))).toBe(false);
  });
});
