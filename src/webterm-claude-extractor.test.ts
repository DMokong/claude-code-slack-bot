import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractTurn, formatTurnForSlack, extractActivity } from "./webterm-claude-extractor";

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

  // trk-reh: the claude CLI TUI began rendering the post-answer spinner with a
  // trailing " · done HH:MM AM" suffix (observed v2.1.260/v2.1.261). Both
  // chrome regexes anchored $ straight after "for \d+s", so the whole line
  // leaked into the extracted answer and shipped to Slack.
  it("filters the spinner when it carries a ' · done HH:MM AM' suffix (trk-reh)", () => {
    const g = [
      "\u276f what is 2 plus 2? answer in one sentence.",
      "",
      "\u23fa 4.",
      "",
      "\u273b Cogitated for 1s \u00b7 done 1:46 AM",
      "\u2500".repeat(60),
      "   Opus 5 \u2502 24%/200k",
    ].join("\n");
    const turn = extractTurn(g, "what is 2 plus 2? answer in one sentence.");
    expect(turn!.assistant).toBe("4.");
    expect(turn!.assistant).not.toContain("Cogitated");
    expect(turn!.assistant).not.toContain("done");
  });

  it("filters the ' · done' spinner in PM and 24h forms too (trk-reh)", () => {
    for (const spinner of [
      "\u273b Cooked for 12s \u00b7 done 11:59 PM",
      "\u273b Pondered for 3s \u00b7 done 13:07",
      "\u00b7 Frolicked for 1s \u00b7 done 1:03 pm",
    ]) {
      const g = ["\u276f q", "", "\u23fa answer text.", "", spinner].join("\n");
      const turn = extractTurn(g, "q");
      expect(turn!.assistant).toBe("answer text.");
    }
  });

  it("still filters the legacy suffix-free spinner (trk-reh regression guard)", () => {
    const g = ["\u276f q", "", "\u23fa answer text.", "", "\u273b Cogitated for 9s"].join("\n");
    expect(extractTurn(g, "q")!.assistant).toBe("answer text.");
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
