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
  /^\s*[✻✶✳✢✽⠂⠐⠈⠁·]\s+\S+(?:ing|ed)\s+for\s+\d+s\s*$/,       // spinner: "✻ Cooked for 3s"
  /^\s*[✻✶✳✢✽⠂⠐⠈⠁·]\s+\S+ing…\s*$/,                         // spinner: "✻ Pondering…" / "· Frolicking…"
  /^\s*Opus\s+\d/,                                           // model status row (pre-Fable)
  /^\s*Fable\s+\d/,                                          // model status row (v2.1.173+)
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
    // Continuation row must start with the indent and not be a marker line.
    if (!next.startsWith(indent)) break;
    if (next.startsWith(DEFAULT_ASSISTANT_MARKER) || next.startsWith(promptMarker)) break;
    consumed += next.trimEnd().length - indent.length;
    i++;
  }
  return i;
}

// Identify the line index of the BOTTOM input box's empty prompt row.
// That row is `<promptMarker>` alone (no following content). When present
// at the bottom of the grid (surrounded by ─── rules), it bounds the turn
// region above it. Returns -1 if not found.
function findBottomPromptRow(lines: string[], promptMarker: string): number {
  const marker = promptMarker.trimEnd();  // "❯ " → "❯"
  // Walk from the bottom upward, looking for an isolated marker.
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === marker) return i;
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

  // The turn region ends at the bottom input box (if present), else at the
  // end of the grid. We pick the bottom prompt row only if it's BELOW the
  // echo we just identified — otherwise the grid has scrolled and the echo
  // we matched is the bottom row.
  const bottomRow = findBottomPromptRow(lines, promptMarker);
  const turnEnd = bottomRow > echoEnd ? bottomRow : lines.length;

  const toolNotes: string[] = [];
  const assistantRaw: string[] = [];
  let inAssistant = false;

  for (let i = echoEnd + 1; i < turnEnd; i++) {
    const line = lines[i];
    if (isChrome(line)) continue;
    if (line.startsWith(assistantMarker)) {
      inAssistant = true;
      // Replace the marker with an equal-width indent so the line's length
      // reflects its true grid width (needed for the wrap-vs-newline test).
      assistantRaw.push(" ".repeat(assistantMarker.length) + line.slice(assistantMarker.length));
      continue;
    }
    if (!inAssistant) {
      // Pre-assistant content — likely a tool-call indicator like
      // "  Searched for 1 pattern (ctrl+o to expand)". Capture if non-blank.
      const trimmed = line.trim();
      if (trimmed !== "") toolNotes.push(trimmed);
      continue;
    }
    assistantRaw.push(line);
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
