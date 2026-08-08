// Per-turn tool-call accumulator (claw-zlr4). The grid shows "⏺ Tool(args)"
// lines as claude works; extractActivity only ever reports the latest one and
// the final answer used to carry no trace at all. This tracks the whole turn:
// a cumulative trail for the live status message, and a one-line recap for the
// end of the turn — the Slack-native form of the SDK path's tool events.

import { TOOL_CALL_RE, TOOL_LABELS } from "./webterm-claude-extractor";

const PROMPT_MARKER = "❯ ";

// Locate the last "❯ " line whose content matches or prefixes `marker` (same
// tolerant idea as the extractor's findLastUserEcho: exact trimmed match, or
// a prompt-marker-prefixed row for input wider than the terminal). Returns -1
// if no such line is on screen.
function findLastMatchingEcho(lines: string[], marker: string): number {
  const target = PROMPT_MARKER + marker;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    if (trimmed === target.trimEnd() || trimmed === target) return i;
    if (line.startsWith(PROMPT_MARKER) && line.startsWith(target.slice(0, line.length))) {
      return i;
    }
  }
  return -1;
}

export class ToolTimeline {
  // Raw "Tool(args…)" line → seen. Grid lines persist across polls, so line
  // identity is the dedupe key; a genuinely repeated identical call on screen
  // at once is indistinguishable and counts once — acceptable.
  private seen = new Set<string>();
  private labels: string[] = [];

  // sinceMarker (claw-uu2u B3): the user's input text for THIS turn. Grids
  // for multi-turn sessions still show earlier turns' "⏺ Tool(...)" lines
  // above the current one; without a scope, observe() would count those too
  // and inflate this turn's trail/recap. When set, only tool lines after the
  // LAST echo of this marker count. Left undefined, observe() scans the
  // whole grid (unscoped, the pre-fix behavior).
  constructor(private readonly sinceMarker?: string) {}

  observe(gridText: string): void {
    const lines = gridText.split("\n");
    let from = 0;
    if (this.sinceMarker !== undefined) {
      const echoLine = findLastMatchingEcho(lines, this.sinceMarker);
      // Marker not on screen — count nothing rather than risk scanning past
      // turn boundaries we can't locate.
      if (echoLine === -1) return;
      from = echoLine + 1;
    }
    for (let i = from; i < lines.length; i++) {
      const line = lines[i].trim();
      const m = TOOL_CALL_RE.exec(line);
      if (!m) continue;
      if (this.seen.has(line)) continue;
      this.seen.add(line);
      this.labels.push(TOOL_LABELS[m[1]] ?? `🔧 ${m[1]}`);
    }
  }

  entries(): string[] {
    return [...this.labels];
  }

  // Live trail for the status placeholder: the last three steps, in order.
  trail(): string | null {
    if (this.labels.length === 0) return null;
    const tail = this.labels.slice(-3);
    // The most recent step is still running — mark it.
    return [...tail.slice(0, -1), `${tail[tail.length - 1]}…`].join(" → ");
  }

  // One muted line for the end of the turn. Null when the turn used no tools.
  recap(elapsedMs: number, costUsd?: number | null): string | null {
    const n = this.labels.length;
    if (n === 0) return null;
    const secs = Math.round(elapsedMs / 1000);
    const parts = [`🔧 ${n} tool call${n === 1 ? "" : "s"}`, `${secs}s`];
    if (typeof costUsd === "number" && costUsd > 0) {
      parts.push(`$${costUsd.toFixed(2)}`);
    }
    return parts.join(" · ");
  }
}
