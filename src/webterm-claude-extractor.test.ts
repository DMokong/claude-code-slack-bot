import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractTurn, formatTurnForSlack } from "./webterm-claude-extractor";

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
      expect(turn.assistant).not.toMatch(/⏵⏵/);
      expect(turn.assistant).not.toMatch(/─{4,}/);
    }
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
