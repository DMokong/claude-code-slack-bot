// Extract the assistant turn from a webterm-hosted `claude` CLI session's
// gridded text (the /api/sessions/:id/text endpoint output). The spike
// memo at claudeclaw/docs/plans/2026-05-29-webterm-claude-spike-learnings.md
// established that:
//   - ANSI-stripped output-chunk bytes are unreadable (TUI is cursor-positioned)
//   - the rendered grid text is the right primitive
//   - the spike's "find the LAST ⏺" extractor lost intermediate steps; this
//     version walks all content between the user input echo and the bottom
//     prompt box, collecting both tool notes and the assistant response.

export interface ExtractedTurn {
  // The unwrapped assistant response, ready for downstream formatting.
  assistant: string;
  // Tool-use notes claude renders BEFORE the ⏺ block (e.g.
  // "Searched for 1 pattern (ctrl+o to expand)"). Indented, no marker.
  // May be empty.
  toolNotes: string[];
}

export interface ExtractOptions {
  // Override if the TUI uses a different prompt marker. claude CLI uses "❯ ".
  promptMarker?: string;
  // Override if the TUI uses different assistant-response markers.
  // claude CLI uses "⏺ ".
  assistantMarker?: string;
}

// One ordered block of the turn: an assistant prose block or a tool block.
export interface Segment {
  kind: "prose" | "tool";
  text: string;
}

const DEFAULT_PROMPT_MARKER = "❯ ";
const DEFAULT_ASSISTANT_MARKER = "⏺ ";
const SPINNER_GLYPHS = "✻✶✳✢✽⠂⠐⠈⠁·";

// Lines we recognize as "screen chrome" that shouldn't appear in extracted
// content. Each rule is independent; a line matching ANY rule is dropped.
const CHROME_RULES: RegExp[] = [
  /^\s*─{4,}\s*$/,                                          // horizontal rules between regions
  /^\s*[✻✶✳✢✽⠂⠐⠈⠁·]\s+\S+(?:ing|ed)\s+for\s+\d+s\s*$/,       // spinner: "✻ Cooked for 3s"
  /^\s*[✻✶✳✢✽⠂⠐⠈⠁·]\s+\S+ing…\s*$/,                         // spinner: "✻ Pondering…" / "· Frolicking…"
  /^\s*(Opus|Fable|Sonnet|Haiku|Mythos)\s+\d/,              // model status row (any model)
  /^\s*[●○]\s+(high|medium|low)\b/,                          // effort indicator
  /^\s*(main|master|HEAD)\s*[●◆◇]?\s*│/,                     // git branch row
  /^\s*🧠\s+/,                                                // memory ribbon
  /^\s*⏵⏵/,                                                  // permissions footer
  /\(shift\+tab/,                                            // permissions hint
  /^\s*no\s?git\s*│/,                                        // no-git status row
  /^\s*\[webterm:/,                                          // webterm prompt prefix (boot line)
];

function isChrome(line: string): boolean {
  return CHROME_RULES.some((re) => re.test(line));
}

const HORIZONTAL_RULE_RE = /^\s*─{4,}\s*$/;
const MODEL_ROW_RE = /^\s*(Opus|Fable|Sonnet|Haiku|Mythos)\s+\d/;
function isRule(line: string | undefined): boolean {
  return !!line && HORIZONTAL_RULE_RE.test(line);
}

// True if `t` (already trimmed) is the input-box prompt line: a bare "❯" or
// "❯" followed by whitespace + dimmed suggestion text. CRITICAL: claude renders
// a NON-BREAKING SPACE (U+00A0) after the marker in the box, not a regular
// space, so the suggestion text leaked past naive `"❯ "` checks.
function isPromptLine(t: string, bareMarker: string): boolean {
  if (t === bareMarker) return true;
  if (!t.startsWith(bareMarker)) return false;
  const next = t.charCodeAt(bareMarker.length);
  return next === 0x20 || next === 0xa0 || next === 0x09; // space | NBSP | tab
}

const SPINNER_FOR_RE = /^[✻✶✳✢✽⠂⠐⠈⠁·]\s+\S+(?:ing|ed)\s+for\s+\d+s$/;
// claw-gxzq: no EOL anchor — the live spinner usually carries a suffix after
// the ellipsis ("✳ Nesting… (5s · ↓ 205 tokens)"); an anchored match only saw
// the bare "✻ Pouncing…" form and let the suffixed form leak into prose.
const SPINNER_VERB_END_RE = /^[✻✶✳✢✽⠂⠐⠈⠁·]\s+\S+…/;
// True if `t` (trimmed) is the first line of the post-answer footer: the
// spinner ("✻ Cooked for 3s" / "✶ Pouncing…") or claude's "※ recap" block.
// Used to end the answer region the moment the footer begins.
function isAnswerEnd(t: string): boolean {
  return t.startsWith("※") || SPINNER_FOR_RE.test(t) || SPINNER_VERB_END_RE.test(t);
}

// A "⏺ Tool(args)" line — a tool INVOCATION, distinct from a "⏺ <prose>"
// assistant block (claw-v3do). The tell: the first token after the marker is
// immediately followed by "(" (e.g. "Grep(", "Bash(", "Read("). Real prose
// never has that shape — its first token is followed by a space ("The third
// section (Environment)…" doesn't match because "third" is followed by " ").
const TOOL_LINE_BODY_RE = /^\w+\(/;

// Locate where the bottom UI footer begins — the robust turn boundary. The
// footer is always: [spinner] ─── / ❯[ + maybe a dimmed contextual suggestion,
// possibly wrapped] / ─── / model-status-row / git / memory / permissions. The
// model-status row is the reliable anchor (always present); we walk up past the
// input box's two ─── rules and cut at the TOP one — so whatever variable text
// claude renders inside the prompt box stays out of the answer. Returns -1 if
// there's no footer yet (mid-render), letting the caller fall back.
function findFooterStart(lines: string[]): number {
  let model = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (MODEL_ROW_RE.test(lines[i])) { model = i; break; }
  }
  if (model === -1) return -1;
  let i = model - 1;
  while (i >= 0 && !isRule(lines[i])) i--;   // box bottom rule
  if (i < 0) return -1;
  i--;
  while (i >= 0 && !isRule(lines[i])) i--;   // box top rule (skip ❯ + wrapped suggestion)
  return i; // -1 if not found → caller falls back
}

// Locate the most recent occurrence of `<promptMarker><userText>` in `lines`,
// allowing for trailing whitespace (the headless grid right-pads rows).
// Returns the line index, or -1 if not found.
function findLastUserEcho(
  lines: string[],
  userText: string,
  promptMarker: string,
): number {
  const target = promptMarker + userText;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trimEnd();
    if (trimmed === target.trimEnd() || trimmed === target) return i;
    // Tolerate input wider than terminal — the first row matches the prefix.
    if (lines[i].startsWith(target.slice(0, lines[i].length))) {
      // Only accept this as a match if the line starts with the prompt marker
      // (avoids false matches against content that happens to share a prefix).
      if (lines[i].startsWith(promptMarker)) return i;
    }
  }
  return -1;
}

// If the user input wrapped onto multiple grid rows, advance past the
// continuation rows. Continuation rows are indented to align with the text
// after the prompt marker (e.g. 2 spaces for "❯ ").
function findEchoEnd(
  lines: string[],
  start: number,
  userText: string,
  promptMarker: string,
): number {
  const indent = " ".repeat(promptMarker.length);
  const firstLineCols = lines[start].length - promptMarker.length;
  let consumed = firstLineCols;
  let i = start;
  while (consumed < userText.length && i + 1 < lines.length) {
    const next = lines[i + 1];
    // A blank row is a paragraph separator INSIDE the echoed multi-line input:
    // webterm right-trims rows, so an indented-but-empty echo row arrives as ""
    // and fails the indent test below. Accept it as a continuation (counting
    // the newline it represents) while we still have user text to account for —
    // otherwise paragraph 2+ of a multi-paragraph message breaks the walk early
    // and lands in the turn region as fake toolNotes (claw-dfcm). The
    // consumed<userText.length loop guard stops us at the echo→answer blank, and
    // the marker break below stops us at the ⏺/❯ boundary, so we never swallow
    // the answer or a genuine pre-answer tool note.
    if (next.trimEnd() === "") {
      consumed += 1;
      i++;
      continue;
    }
    // Content continuation row must start with the indent and not be a marker.
    if (!next.startsWith(indent)) break;
    if (next.startsWith(DEFAULT_ASSISTANT_MARKER) || next.startsWith(promptMarker)) break;
    consumed += next.trimEnd().length - indent.length;
    i++;
  }
  return i;
}

// Identify the line index of the BOTTOM input box's prompt row, which bounds
// the turn region above it. The box is normally `<promptMarker>` alone, but
// claude sometimes renders a dimmed contextual suggestion inside it (e.g.
// "❯ list them out") — so we also accept a `❯ …` line that's wrapped in the
// box's ─── rules (the structural tell that distinguishes the input box from
// the user-echo line up in the scrollback). Returns -1 if not found.
function findBottomPromptRow(lines: string[], promptMarker: string): number {
  const marker = promptMarker.trimEnd();  // "❯ " → "❯"
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === marker) return i;
    // Input box with ghost/suggestion text (note: claude uses a NON-BREAKING
    // space after the marker). Require a ─── rule within ~2 lines above (box
    // top) so the scrollback user-echo line never matches.
    if (isPromptLine(trimmed, marker) && (isRule(lines[i - 1]) || isRule(lines[i - 2]))) {
      return i;
    }
  }
  return -1;
}

// East Asian wide ranges as xterm's wcwidth sees them: CJK ideographs, Kana,
// Hangul, fullwidth forms, wide punctuation. Emoji deliberately stay width-1 —
// that matches the emulator's current rendering (claw-nsdh), and the point is
// to measure the GRID, not ideal Unicode.
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||   // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) ||   // CJK radicals + symbols
    (cp >= 0x3041 && cp <= 0x33ff) ||   // Kana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) ||   // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) ||   // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK compat ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) ||   // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) ||   // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||   // Fullwidth signs
    (cp >= 0x20000 && cp <= 0x2fffd) || // CJK Ext B+
    (cp >= 0x30000 && cp <= 0x3fffd)
  );
}

// Width of a row in terminal COLUMNS (claw-3btg.5): the grid hard-wraps by
// columns, and a full-width CJK row occupies 2 columns per glyph while
// String.length counts 1 — measuring with .length made wrapped CJK prose look
// far short of the wrap threshold, so unwrapWordWrap treated genuine wraps as
// intentional newlines and mangled paragraphs.
export function displayWidth(line: string): number {
  let w = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    w += cp !== undefined && isWideCodePoint(cp) ? 2 : 1;
  }
  return w;
}

// Unwrap word-wrapped continuation lines while PRESERVING intentional newlines
// (code blocks, short list/code lines). claude's TUI hard-wraps long prose at
// the grid width, so a row is a wrap-continuation only if the PREVIOUS physical
// row actually reached near the terminal width. A short previous row (e.g. a
// line of code) means the newline was intentional — don't join (H4).
//
// `lines` are normalized so the assistant marker is replaced with an
// equal-width indent upstream; widths are measured in terminal columns via
// displayWidth (NOT .length — see claw-3btg.5).
function unwrapWordWrap(lines: string[], indent: number, cols: number): string[] {
  // A wrapped row breaks at a word boundary, leaving up to ~one word of slack.
  // Real captures: wrapped prose fills cols-1..cols-4 (116-119 of 120); code
  // lines sit far below. A generous slack separates them without joining code.
  const wrapThreshold = Math.max(indent + 1, cols - 24);
  const out: string[] = [];
  let prevWidth = 0; // grid width of the previous physical row
  for (const line of lines) {
    if (line.trim() === "") {
      out.push("");
      prevWidth = 0;
      continue;
    }
    const leading = /^\s*/.exec(line)?.[0].length ?? 0;
    const body = line.slice(leading);
    const isListItem = /^([-*•]|\d+[.)])\s/.test(body);
    if (
      out.length > 0 &&
      out[out.length - 1].trim() !== "" &&
      leading >= indent &&
      !isListItem &&
      prevWidth >= wrapThreshold
    ) {
      // Continuation of a wrapped line — join with a single space.
      out[out.length - 1] = out[out.length - 1].replace(/\s+$/, "") + " " + body.trimStart();
    } else {
      // Keep indentation BEYOND the block-marker indent (claw-badj): code
      // inside a ⏺ block is indented past the 2-col base, and flattening it
      // shipped syntactically-invalid Python to Slack. The base indent itself
      // still strips so prose stays flush.
      out.push(" ".repeat(Math.max(0, leading - indent)) + body);
    }
    prevWidth = displayWidth(line);
  }
  return out;
}

// One source of truth for the echo→footer walk. Returns the raw prose lines
// (flat, marker-stripped — what extractTurn unwraps as one block, preserving
// today's exact output), the flat tool-note lines (what extractTurn returns as
// toolNotes), and the ORDERED segments (what extractSegments returns). The
// critical change vs. the old inline loop: a ※/spinner line no longer BREAKS
// the walk — it enters "chrome" mode (skip the line and its indented
// continuations until the next ⏺), so real content rendered after a tip
// survives (claw-gxzq).
interface WalkResult {
  proseRaw: string[];          // flat, for extractTurn's single-block unwrap
  toolNotes: string[];         // flat, for extractTurn
  segments: { kind: "prose" | "tool"; raw: string[] }[]; // ordered
}

function walkTurn(
  lines: string[],
  echoEnd: number,
  turnEnd: number,
  assistantMarker: string,
  promptMarker: string,
): WalkResult {
  const proseRaw: string[] = [];
  const toolNotes: string[] = [];
  const segments: { kind: "prose" | "tool"; raw: string[] }[] = [];
  let mode: "none" | "prose" | "tool" | "chrome" = "none";
  const bareMarker = promptMarker.trimEnd(); // "❯"
  const cur = () => segments[segments.length - 1];

  for (let i = echoEnd + 1; i < turnEnd; i++) {
    const line = lines[i];
    const t = line.trim();
    // Hard stop at the bottom input box (we are already past the user echo).
    if (isPromptLine(t, bareMarker)) break;
    // ※ tip/recap or a spinner line: SKIP it and its continuations (chrome),
    // do NOT terminate — content after it is still the answer.
    if (isAnswerEnd(t)) { mode = "chrome"; continue; }
    if (isChrome(line)) continue;
    if (line.startsWith(assistantMarker)) {
      const body = line.slice(assistantMarker.length);
      if (TOOL_LINE_BODY_RE.test(body.trimStart())) {
        mode = "tool";
        toolNotes.push(body.trim());
        segments.push({ kind: "tool", raw: [body.trim()] });
      } else {
        mode = "prose";
        const indented = " ".repeat(assistantMarker.length) + body;
        proseRaw.push(indented);
        segments.push({ kind: "prose", raw: [indented] });
      }
      continue;
    }
    // Continuation of the current block.
    if (mode === "prose") {
      proseRaw.push(line);
      cur().raw.push(line);
    } else if (mode === "tool") {
      if (t !== "") { toolNotes.push(t); cur().raw.push(t); }
    } else if (mode === "none") {
      // Pre-marker dimmed indicator ("Searched for 1 pattern …").
      if (t !== "") toolNotes.push(t);
    }
    // mode === "chrome": skip.
  }
  return { proseRaw, toolNotes, segments };
}

export function extractTurn(
  gridText: string,
  userInputText: string,
  opts: ExtractOptions = {},
): ExtractedTurn | null {
  const promptMarker = opts.promptMarker ?? DEFAULT_PROMPT_MARKER;
  const assistantMarker = opts.assistantMarker ?? DEFAULT_ASSISTANT_MARKER;
  const lines = gridText.split("\n");

  const echoStart = findLastUserEcho(lines, userInputText, promptMarker);
  if (echoStart === -1) return null;
  const echoEnd = findEchoEnd(lines, echoStart, userInputText, promptMarker);

  // The turn region ends at the bottom UI footer. Prefer the footer anchored
  // on the model-status row (robust to whatever claude renders in the input
  // box); fall back to the isolated-prompt detector, then to end-of-grid. All
  // candidates must be BELOW the echo, else the grid scrolled and the echo we
  // matched is itself at the bottom.
  const footerStart = findFooterStart(lines);
  let turnEnd: number;
  if (footerStart > echoEnd) {
    turnEnd = footerStart;
  } else {
    const bottomRow = findBottomPromptRow(lines, promptMarker);
    turnEnd = bottomRow > echoEnd ? bottomRow : lines.length;
  }

  const { proseRaw, toolNotes } = walkTurn(lines, echoEnd, turnEnd, assistantMarker, promptMarker);
  const assistantRaw = proseRaw;

  // Trim trailing blank lines from the assistant block.
  while (assistantRaw.length > 0 && assistantRaw[assistantRaw.length - 1].trim() === "") {
    assistantRaw.pop();
  }

  // Grid width: the full-width chrome rows (── rules, status bar) set it.
  // Fall back to a sane default if the grid is unusually narrow.
  const cols = Math.max(40, ...lines.map((l) => displayWidth(l)));
  const unwrapped = unwrapWordWrap(assistantRaw, assistantMarker.length, cols);
  const assistant = unwrapped.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { assistant, toolNotes };
}

// Ordered view of the turn for streaming relay (claw-gxzq). Same boundary and
// walk as extractTurn, but returns each ⏺ block as its own Segment in render
// order. Prose blocks are unwrapped individually; tool blocks keep their raw
// lines joined. Returns [] when the user echo can't be located.
export function extractSegments(
  gridText: string,
  userInputText: string,
  opts: ExtractOptions = {},
): Segment[] {
  const promptMarker = opts.promptMarker ?? DEFAULT_PROMPT_MARKER;
  const assistantMarker = opts.assistantMarker ?? DEFAULT_ASSISTANT_MARKER;
  const lines = gridText.split("\n");

  const echoStart = findLastUserEcho(lines, userInputText, promptMarker);
  if (echoStart === -1) return [];
  const echoEnd = findEchoEnd(lines, echoStart, userInputText, promptMarker);

  const footerStart = findFooterStart(lines);
  let turnEnd: number;
  if (footerStart > echoEnd) {
    turnEnd = footerStart;
  } else {
    const bottomRow = findBottomPromptRow(lines, promptMarker);
    turnEnd = bottomRow > echoEnd ? bottomRow : lines.length;
  }

  const { segments } = walkTurn(lines, echoEnd, turnEnd, assistantMarker, promptMarker);
  const cols = Math.max(40, ...lines.map((l) => displayWidth(l)));
  const out: Segment[] = [];
  for (const seg of segments) {
    if (seg.kind === "prose") {
      const raw = [...seg.raw];
      while (raw.length > 0 && raw[raw.length - 1].trim() === "") raw.pop();
      const text = unwrapWordWrap(raw, assistantMarker.length, cols)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (text) out.push({ kind: "prose", text });
    } else {
      const text = seg.raw.join("\n").trim();
      if (text) out.push({ kind: "tool", text });
    }
  }
  return out;
}

// An active spinner is present-continuous ("✻ Tinkering…") — claude is working.
// The past-tense elapsed line ("✻ Cooked for 3s") is a post-turn artifact and
// does NOT count as active. The discriminator is the ellipsis: an active
// spinner ALWAYS carries "Verb…", a completed line reads "Verbed for Ns".
//
// claw-gxzq (2026-07-03): must NOT anchor the ellipsis to end-of-line — claude's
// real spinner renders a live suffix after it, e.g.
//   "✻ Whirring… (7s · ↓ 154 tokens · thought for 1s)"
// The old `…\s*$` anchor missed that, so mid-generation grids read as idle and
// the continuous relay finalized the Slack message at ~7s while claude was still
// producing output. Match "glyph + word + …" anywhere on the line instead.
const ACTIVE_SPINNER_RE = new RegExp(`^\\s*[${SPINNER_GLYPHS}]\\s+\\S+…`);

// True when the grid shows claude idle at its input prompt: the bottom input
// box is present AND no active spinner is rendered. Used by the relay loop to
// decide a turn is finished (claw-gxzq).
export function isGridIdle(gridText: string, opts: ExtractOptions = {}): boolean {
  const promptMarker = opts.promptMarker ?? DEFAULT_PROMPT_MARKER;
  const lines = gridText.split("\n");
  if (lines.some((l) => ACTIVE_SPINNER_RE.test(l))) return false;
  return findBottomPromptRow(lines, promptMarker) !== -1;
}

// Past-tense spinner footer — claude's positive "turn complete" tell
// ("✻ Cooked for 12s", "✶ Pounced for 2m 14s"). Distinct from SPINNER_FOR_RE
// only in accepting minute-form durations. Used as END EVIDENCE by the relay
// (claw-46g8): a frozen idle grid WITHOUT this line is more likely a
// mid-answer model pause than a finished turn — the live-verified haiku drop.
const PAST_SPINNER_RE = new RegExp(`^[${SPINNER_GLYPHS}]\\s+\\S+(?:ing|ed)\\s+for\\s+[\\d]+[smh](?:\\s*[\\d]+[smh])?$`);

// True iff a past-tense spinner appears BELOW the last user echo — i.e. the
// current turn (not a previous one) has rendered its completion footer.
export function hasTurnEndFooter(
  gridText: string,
  userInputText: string,
  opts: ExtractOptions = {},
): boolean {
  const promptMarker = opts.promptMarker ?? DEFAULT_PROMPT_MARKER;
  const lines = gridText.split("\n");
  const echoStart = findLastUserEcho(lines, userInputText, promptMarker);
  if (echoStart === -1) return false;
  for (let i = echoStart + 1; i < lines.length; i++) {
    if (PAST_SPINNER_RE.test(lines[i].trim())) return true;
  }
  return false;
}

// Parse of claude's model-status row (claw-s5k5):
//   "Sonnet 4.6 │ █████░░░ 25%%/200k (21.3k) │ $0.30 │ ⏱ 26m7s"
// All fields best-effort — absent pieces come back undefined.
export interface ParsedStatusRow {
  model?: string;
  contextPct?: number;
  contextLimitK?: number;
  tokens?: number;
  costUsd?: number;
  elapsed?: string;
}

export function parseStatusRow(gridText: string): ParsedStatusRow | null {
  const row = gridText.split("\n").find((l) => MODEL_ROW_RE.test(l));
  if (!row) return null;
  const out: ParsedStatusRow = {};
  const model = /^\s*((?:Opus|Fable|Sonnet|Haiku|Mythos)\s+[\d.]+(?:\[[^\]]+\])?)/.exec(row);
  if (model) out.model = model[1].trim();
  const pct = /(\d+)%/.exec(row);
  if (pct) out.contextPct = Number(pct[1]);
  const limit = /%+\/(\d+)k/.exec(row);
  if (limit) out.contextLimitK = Number(limit[1]);
  const tokens = /\(([\d.]+)(k?)\)/.exec(row);
  if (tokens) out.tokens = Math.round(Number(tokens[1]) * (tokens[2] === "k" ? 1000 : 1));
  const cost = /\$([\d.]+)/.exec(row);
  if (cost) out.costUsd = Number(cost[1]);
  const elapsed = /⏱\s*([\dhms]+(?:\s*[\dhms]+)*)/.exec(row);
  if (elapsed) out.elapsed = elapsed[1].replace(/\s+/g, "");
  return out;
}

// Format the extracted turn as a single Slack mrkdwn-safe string.
// v1 is intentionally simple: tool notes prefix as italic, assistant body
// passes through as-is. Slack mrkdwn renders newlines as visible line breaks,
// so the unwrap step above is what makes the result look natural.
export function formatTurnForSlack(turn: ExtractedTurn): string {
  const parts: string[] = [];
  for (const note of turn.toolNotes) {
    parts.push(`_${note}_`);
  }
  if (turn.assistant) parts.push(turn.assistant);
  return parts.join("\n\n");
}

// ---- live-turn activity (for streaming status to Slack) ----
//
// The webterm path is request/response, so there's no token stream. But the
// grid exposes claude's live state the whole time it works: a spinner line
// ("✻ Crunched for 3s", "✶ Pouncing…") and tool-call markers ("⏺ Bash(…)").
// extractActivity turns the CURRENT grid into a short human status so the bot
// can chat.update a placeholder message while the turn runs.

const SPINNER_ELAPSED_RE = new RegExp(`^[${SPINNER_GLYPHS}]\\s+\\S+\\s+for\\s+(\\d+)s$`);
const SPINNER_VERB_RE = new RegExp(`^[${SPINNER_GLYPHS}]\\s+(\\S+…)$`);
// Tool-call line: "⏺ Bash(…)" — a capitalized tool name immediately followed
// by "(". Distinct from the assistant-response "⏺ <prose>" (no Name( shape).
export const TOOL_CALL_RE = /^⏺\s+([A-Z][A-Za-z0-9_]*)\(/;

export const TOOL_LABELS: Record<string, string> = {
  Bash: "🔧 running a command",
  Read: "📖 reading a file",
  Edit: "✏️ editing",
  MultiEdit: "✏️ editing",
  Write: "✏️ writing a file",
  Grep: "🔎 searching the code",
  Glob: "🔎 finding files",
  Task: "🤖 running a subagent",
  WebFetch: "🌐 fetching a page",
  WebSearch: "🌐 searching the web",
  TodoWrite: "📝 planning",
};

// Returns a short status label for the in-progress turn, or null if the grid
// shows no recognizable activity yet. Tool activity wins over the spinner
// (more informative); the most recent tool in the grid is reported.
export function extractActivity(gridText: string): string | null {
  const lines = gridText.split("\n");
  let tool: string | null = null;
  let elapsed: number | null = null;
  let verb: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const t = TOOL_CALL_RE.exec(line);
    if (t) { tool = t[1]; continue; }
    const e = SPINNER_ELAPSED_RE.exec(line);
    if (e) { elapsed = Number(e[1]); continue; }
    const v = SPINNER_VERB_RE.exec(line);
    if (v) { verb = v[1]; continue; }
  }
  if (tool) return `${TOOL_LABELS[tool] ?? `🔧 ${tool}`}…`;
  if (elapsed !== null) return `✻ thinking… (${elapsed}s)`;
  if (verb) return `✻ ${verb}`;
  return null;
}
