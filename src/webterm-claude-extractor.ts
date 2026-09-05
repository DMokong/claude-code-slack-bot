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

const DEFAULT_PROMPT_MARKER = "❯ ";
const DEFAULT_ASSISTANT_MARKER = "⏺ ";

// Lines we recognize as "screen chrome" that shouldn't appear in extracted
// content. Each rule is independent; a line matching ANY rule is dropped.
const CHROME_RULES: RegExp[] = [
  /^\s*─{4,}\s*$/,                                          // horizontal rules between regions
  /^\s*[✻✶✳✢✽⠂⠐⠈⠁·]\s+\S+(?:ing|ed)\s+for\s+\d+s(?:\s*·\s*done\s+\d{1,2}:\d{2}(?:\s*[APap][Mm])?)?\s*$/,       // spinner: "✻ Cooked for 3s"
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

const SPINNER_FOR_RE = /^[✻✶✳✢✽⠂⠐⠈⠁·]\s+\S+(?:ing|ed)\s+for\s+\d+s(?:\s*·\s*done\s+\d{1,2}:\d{2}(?:\s*[APap][Mm])?)?$/;
const SPINNER_VERB_END_RE = /^[✻✶✳✢✽⠂⠐⠈⠁·]\s+\S+…$/;
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

// Unwrap word-wrapped continuation lines while PRESERVING intentional newlines
// (code blocks, short list/code lines). claude's TUI hard-wraps long prose at
// the grid width, so a row is a wrap-continuation only if the PREVIOUS physical
// row actually reached near the terminal width. A short previous row (e.g. a
// line of code) means the newline was intentional — don't join (H4).
//
// `lines` are normalized so every entry's `.length` equals its true grid width
// (the assistant marker is replaced with an equal-width indent upstream).
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
      out.push(body);
    }
    prevWidth = line.length;
  }
  return out;
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

  const toolNotes: string[] = [];
  const assistantRaw: string[] = [];
  // The turn is a sequence of blocks. Each "⏺ " marker starts a new one,
  // classified as "tool" (⏺ Tool(args)) or "prose" (⏺ <answer text>); content
  // before the first marker ("none") is a dimmed tool indicator. A block's
  // continuation rows inherit its mode — so a tool call's "⎿ result" rows go to
  // toolNotes, and the assistant body collects only prose blocks (claw-v3do).
  let mode: "none" | "prose" | "tool" = "none";
  let seenMarker = false;
  const bareMarker = promptMarker.trimEnd(); // "❯"

  for (let i = echoEnd + 1; i < turnEnd; i++) {
    const line = lines[i];
    // Hard stop at the bottom input box. We're already PAST the user echo, so
    // any prompt-marker line here is the input box — never answer content.
    // This is the backstop when the footer wasn't fully rendered at extraction
    // (claude's dimmed input suggestion is dynamic and can leak otherwise).
    const t = line.trim();
    if (isPromptLine(t, bareMarker)) break;
    // Once any ⏺ block has started, the FIRST footer marker (spinner or the
    // new "※ recap" block) ends the turn — everything below is chrome/footer,
    // no matter what dynamic content claude renders there. This is what keeps
    // the recap, ghost suggestions, and status rows out robustly.
    if (seenMarker && isAnswerEnd(t)) break;
    if (isChrome(line)) continue;
    if (line.startsWith(assistantMarker)) {
      seenMarker = true;
      const body = line.slice(assistantMarker.length);
      if (TOOL_LINE_BODY_RE.test(body.trimStart())) {
        // A tool INVOCATION block (⏺ Grep(…)) — capture as a tool note, not
        // prose, and route its continuation rows (⎿ result) to toolNotes too.
        mode = "tool";
        toolNotes.push(body.trim());
      } else {
        // A prose block (⏺ <answer text>). Replace the marker with an
        // equal-width indent so the line's length reflects its true grid width
        // (needed for the wrap-vs-newline test).
        mode = "prose";
        assistantRaw.push(" ".repeat(assistantMarker.length) + body);
      }
      continue;
    }
    // Non-marker line — a continuation of the current block.
    if (mode === "prose") {
      assistantRaw.push(line);
    } else if (t !== "") {
      // "tool" continuation (⎿ summary, wrapped args) or a pre-marker dimmed
      // indicator like "Searched for 1 pattern (ctrl+o to expand)".
      toolNotes.push(t);
    }
  }

  // Trim trailing blank lines from the assistant block.
  while (assistantRaw.length > 0 && assistantRaw[assistantRaw.length - 1].trim() === "") {
    assistantRaw.pop();
  }

  // Grid width: the full-width chrome rows (── rules, status bar) set it.
  // Fall back to a sane default if the grid is unusually narrow.
  const cols = Math.max(40, ...lines.map((l) => l.length));
  const unwrapped = unwrapWordWrap(assistantRaw, assistantMarker.length, cols);
  const assistant = unwrapped.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { assistant, toolNotes };
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

const SPINNER_GLYPHS = "✻✶✳✢✽⠂⠐⠈⠁·";
const SPINNER_ELAPSED_RE = new RegExp(`^[${SPINNER_GLYPHS}]\\s+\\S+\\s+for\\s+(\\d+)s$`);
const SPINNER_VERB_RE = new RegExp(`^[${SPINNER_GLYPHS}]\\s+(\\S+…)$`);
// Tool-call line: "⏺ Bash(…)" — a capitalized tool name immediately followed
// by "(". Distinct from the assistant-response "⏺ <prose>" (no Name( shape).
const TOOL_CALL_RE = /^⏺\s+([A-Z][A-Za-z0-9_]*)\(/;

const TOOL_LABELS: Record<string, string> = {
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
