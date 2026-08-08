// Outbound formatting for the webterm path (claw-lzju, claw-g450).
//
// claude emits GitHub-flavored markdown; Slack renders mrkdwn — a different
// dialect (*bold*, <url|text>, no headers). And the grid scrape destroys code
// fences entirely (the TUI renders code visually, never as literal ```), so
// code arrives as bare lines. refenceCode reconstructs fences from line shape;
// toMrkdwn converts the markdown claude actually writes into what Slack renders.
//
// Both operate on extracted turn text, i.e. AFTER webterm-claude-extractor —
// which preserves relative indentation (claw-badj), the signal refenceCode
// leans on.

const FENCE_RE = /^```/;

// Split text into alternating segments so transforms never touch fenced code.
function splitByFences(text: string): { fenced: boolean; lines: string[] }[] {
  const segments: { fenced: boolean; lines: string[] }[] = [];
  let cur: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (FENCE_RE.test(line.trim())) {
      if (!fenced) {
        if (cur.length) segments.push({ fenced: false, lines: cur });
        cur = [line];
        fenced = true;
      } else {
        cur.push(line);
        segments.push({ fenced: true, lines: cur });
        cur = [];
        fenced = false;
      }
      continue;
    }
    cur.push(line);
  }
  if (cur.length) segments.push({ fenced, lines: cur });
  return segments;
}

// A line that looks like source code rather than prose. Two independent
// signals: meaningful leading indentation, or code-shaped syntax. List items
// are always prose — claude's dash/numbered lists are the false-positive
// magnet here.
const LIST_ITEM_RE = /^\s*([-*•]|\d+[.)])\s/;
const CODE_SHAPE_RE =
  /(=>|[;{}]\s*$|^\s*(def|return|const|let|var|import|from|class|if|for|while|function|elif|else:|try:|except)\b|\w+\([^)]*\)\s*(:|{|$))/;

function isCodeLine(line: string): boolean {
  if (line.trim() === "") return false;
  if (LIST_ITEM_RE.test(line)) return false;
  const indented = /^\s{2,}/.test(line);
  return indented || CODE_SHAPE_RE.test(line);
}

// Wrap runs of >= 2 consecutive code-shaped lines in triple-backtick fences.
// Single code-ish lines stay prose (mentioning `compute()` in a sentence must
// not fence the sentence).
export function refenceCode(text: string): string {
  const out: string[] = [];
  for (const seg of splitByFences(text)) {
    if (seg.fenced) {
      out.push(...seg.lines);
      continue;
    }
    const lines = seg.lines;
    let i = 0;
    while (i < lines.length) {
      if (isCodeLine(lines[i])) {
        let j = i;
        while (j < lines.length && isCodeLine(lines[j])) j++;
        if (j - i >= 2) {
          out.push("```", ...lines.slice(i, j), "```");
        } else {
          out.push(...lines.slice(i, j));
        }
        i = j;
      } else {
        out.push(lines[i]);
        i++;
      }
    }
  }
  return out.join("\n");
}

// Markdown -> Slack mrkdwn on non-code text. Inline code spans are shielded
// the same way fenced blocks are.
function transformProseLine(line: string): string {
  // Headers first — the whole line becomes bold.
  const header = /^(#{1,6})\s+(.*)$/.exec(line);
  if (header) return `*${header[2].trim()}*`;
  // Shield inline code spans, transform the rest, then restore.
  const spans: string[] = [];
  let shielded = line.replace(/`[^`]*`/g, (m) => {
    spans.push(m);
    return `\u0000${spans.length - 1}\u0000`;
  });
  shielded = shielded
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>");
  return shielded.replace(/\u0000(\d+)\u0000/g, (_, n) => spans[Number(n)]);
}

export function toMrkdwn(text: string): string {
  const out: string[] = [];
  for (const seg of splitByFences(text)) {
    if (seg.fenced) out.push(...seg.lines);
    else out.push(...seg.lines.map(transformProseLine));
  }
  return out.join("\n");
}

// The single entry point delivery paths use: reconstruct code fences, then
// convert markdown to mrkdwn around them.
export function formatForSlack(text: string): string {
  return toMrkdwn(refenceCode(text));
}
