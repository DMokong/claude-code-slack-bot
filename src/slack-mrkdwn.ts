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

// Flush-left lines get a MUCH more conservative test than indented ones
// (claw-uu2u B1): prose sentences routinely mention `compute()` or use "=>"
// as informal notation ("slack => bot"), and a loose shape regex fenced them
// wholesale, eating bold markers along the way. Markdown markers or a
// sentence-ending period/!/? veto code status outright; a leading keyword
// then overrides the generic "reads as prose" veto (a `return` statement has
// no `=`/`;`/`{` but is still code).
const FLUSH_MD_MARKER_RE = /\*\*|\[[^\]]+\]\(/;
const FLUSH_SENTENCE_END_RE = /[.!?]\s*$/;
const FLUSH_KEYWORD_RE =
  /^(def|return|const|let|var|import|from|class|for|while|if|elif|try|except|function)\b/;
const FLUSH_BLOCK_END_RE = /\)\s*[{;:]\s*$/;
const FLUSH_ASSIGNMENT_RE = /^[\w$.[\]]+\s*=\s*\S/;

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function isFlushLeftCode(trimmed: string): boolean {
  if (FLUSH_MD_MARKER_RE.test(trimmed)) return false;
  if (FLUSH_SENTENCE_END_RE.test(trimmed)) return false;
  if (FLUSH_KEYWORD_RE.test(trimmed)) return true;
  if (wordCount(trimmed) >= 4 && !/[=;{]/.test(trimmed)) return false; // reads as prose
  if (FLUSH_BLOCK_END_RE.test(trimmed)) return true;
  if (FLUSH_ASSIGNMENT_RE.test(trimmed)) return true;
  return false;
}

function isCodeLine(line: string): boolean {
  if (line.trim() === "") return false;
  if (LIST_ITEM_RE.test(line)) return false;
  if (/^\s{2,}/.test(line)) return true; // indentation is the reliable signal
  return isFlushLeftCode(line.trim());
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

// Shield inline code spans so bold/link conversion never touches their
// contents, run `transform` on what's left, then restore the spans verbatim.
function withCodeShielded(text: string, transform: (s: string) => string): string {
  const spans: string[] = [];
  const shielded = text.replace(/`[^`]*`/g, (m) => {
    spans.push(m);
    return `\u0000${spans.length - 1}\u0000`;
  });
  return transform(shielded).replace(/\u0000(\d+)\u0000/g, (_, n) => spans[Number(n)]);
}

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;

// Markdown -> Slack mrkdwn on non-code text. Inline code spans are shielded
// the same way fenced blocks are.
function transformProseLine(line: string): string {
  // Headers first — the whole line becomes bold. Links/inline-code inside the
  // header still need converting, but bold markers must be DROPPED rather
  // than converted: `**now**` inside a header would produce nested
  // `*…*now*…*`, which Slack renders badly — the header's own bold wrapper
  // already covers it (claw-uu2u B5).
  const header = /^(#{1,6})\s+(.*)$/.exec(line);
  if (header) {
    const inner = withCodeShielded(header[2].trim(), (s) =>
      s.replace(BOLD_RE, "$1").replace(LINK_RE, "<$2|$1>"),
    );
    return `*${inner}*`;
  }
  return withCodeShielded(line, (s) => s.replace(BOLD_RE, "*$1*").replace(LINK_RE, "<$2|$1>"));
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
