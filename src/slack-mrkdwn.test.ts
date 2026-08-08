import { describe, it, expect } from "vitest";
import { toMrkdwn, refenceCode, formatForSlack } from "./slack-mrkdwn";

describe("toMrkdwn", () => {
  it("converts **bold** to *bold*", () => {
    expect(toMrkdwn("this is **important** stuff")).toBe("this is *important* stuff");
  });

  it("converts markdown links to slack links", () => {
    expect(toMrkdwn("see [the docs](https://example.com/a) for more")).toBe(
      "see <https://example.com/a|the docs> for more",
    );
  });

  it("converts headers to bold lines", () => {
    expect(toMrkdwn("## Results\nbody text")).toBe("*Results*\nbody text");
    expect(toMrkdwn("### Deep header")).toBe("*Deep header*");
  });

  it("leaves inline code untouched", () => {
    expect(toMrkdwn("run `npm **test**` now")).toBe("run `npm **test**` now");
  });

  it("leaves fenced code blocks untouched", () => {
    const fenced = "```\nconst x = **not bold**;\n```";
    expect(toMrkdwn(fenced)).toBe(fenced);
  });

  it("passes plain prose through unchanged", () => {
    const prose = "Nothing special here — just words, dashes - and (parens).";
    expect(toMrkdwn(prose)).toBe(prose);
  });

  it("does not corrupt prose containing bare numbers", () => {
    const prose = "the result of 17 * 23 * 2 is 782";
    expect(toMrkdwn(prose)).toBe(prose);
  });

  it("handles inline code and numbers on the same line", () => {
    expect(toMrkdwn("run `x **y**` then 42 more")).toBe("run `x **y**` then 42 more");
  });
});

describe("refenceCode", () => {
  it("fences a run of indented code lines", () => {
    const input = [
      "Here is the function:",
      "",
      "  def compute():",
      "      return 17 * 23 * 2",
      "",
      "That's it.",
    ].join("\n");
    const out = refenceCode(input);
    expect(out).toContain("```\n  def compute():\n      return 17 * 23 * 2\n```");
    expect(out.startsWith("Here is the function:")).toBe(true);
    expect(out.endsWith("That's it.")).toBe(true);
  });

  it("fences flush-left code-shaped runs", () => {
    const input = "def compute():\nreturn 17 * 23 * 2";
    expect(refenceCode(input)).toBe("```\ndef compute():\nreturn 17 * 23 * 2\n```");
  });

  it("never fences prose paragraphs", () => {
    const prose =
      "ClaudeClaw is a personal AI agent workspace that orchestrates several surfaces.\nIt handles life and engineering tasks with Slack as the control plane.";
    expect(refenceCode(prose)).toBe(prose);
  });

  it("never fences dash lists", () => {
    const list = "- com.claudeclaw.alloy.plist\n- com.claudeclaw.slack-bot.plist";
    expect(refenceCode(list)).toBe(list);
  });

  it("does not double-fence existing fenced blocks", () => {
    const fenced = "```python\ndef f():\n    return 1\n```";
    expect(refenceCode(fenced)).toBe(fenced);
  });

  it("does not fence a single code-ish line", () => {
    const single = "Use compute() for that.";
    expect(refenceCode(single)).toBe(single);
  });
});

describe("formatForSlack", () => {
  it("re-fences then converts markdown", () => {
    const input = "**Result:** see below\n\ndef compute():\nreturn 782";
    const out = formatForSlack(input);
    expect(out).toContain("*Result:* see below");
    expect(out).toContain("```\ndef compute():\nreturn 782\n```");
  });
});
