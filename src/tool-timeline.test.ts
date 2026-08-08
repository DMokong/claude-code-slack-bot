import { describe, it, expect } from "vitest";
import { ToolTimeline } from "./tool-timeline";

const gridWith = (...toolLines: string[]) =>
  ["❯ do things", "", ...toolLines, "", "❯", ""].join("\n");

describe("ToolTimeline", () => {
  it("collects tool calls across polls without duplicating persistent grid lines", () => {
    const t = new ToolTimeline();
    t.observe(gridWith("⏺ Bash(ls -la)"));
    t.observe(gridWith("⏺ Bash(ls -la)")); // same line still on screen
    t.observe(gridWith("⏺ Bash(ls -la)", "⏺ Grep(pattern)"));
    expect(t.entries()).toEqual(["🔧 running a command", "🔎 searching the code"]);
  });

  it("trail shows the last three labels joined with arrows", () => {
    const t = new ToolTimeline();
    t.observe(gridWith("⏺ Bash(a)", "⏺ Grep(b)", "⏺ Read(c)", "⏺ Edit(d)"));
    expect(t.trail()).toBe("🔎 searching the code → 📖 reading a file → ✏️ editing…");
  });

  it("trail is null with no tools", () => {
    expect(new ToolTimeline().trail()).toBeNull();
  });

  it("recap summarizes count, duration, and cost delta", () => {
    const t = new ToolTimeline();
    t.observe(gridWith("⏺ Bash(a)", "⏺ Grep(b)"));
    expect(t.recap(14_300, 0.02)).toBe("🔧 2 tool calls · 14s · $0.02");
    expect(t.recap(2_000)).toBe("🔧 2 tool calls · 2s");
  });

  it("recap singular form and null when toolless", () => {
    const t = new ToolTimeline();
    expect(t.recap(5_000)).toBeNull();
    t.observe(gridWith("⏺ Bash(a)"));
    expect(t.recap(5_000)).toBe("🔧 1 tool call · 5s");
  });

  it("unknown tools fall back to the raw name", () => {
    const t = new ToolTimeline();
    t.observe(gridWith("⏺ FrobnicateStuff(x)"));
    expect(t.entries()).toEqual(["🔧 FrobnicateStuff"]);
  });
});
