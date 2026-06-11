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

// Unwrap word-wrapped continuation lines. claude's TUI wraps long sentences
// at the grid width; continuation rows are indented by `assistantMarker.length`
// (typically 2 spaces). Join those back to the prior line with a single space.
// Lines that start with a list bullet ("- ", "* ", or "N. ") or are blank
// are preserved as-is.
function unwrapWordWrap(lines: string[], indent: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      out.push("");
      continue;
    }
    const leading = /^\s*/.exec(line)?.[0].length ?? 0;
    const body = line.slice(leading);
    const isListItem = /^([-*•]|\d+[.)])\s/.test(body);
    if (
      out.length > 0 &&
      out[out.length - 1].trim() !== "" &&
      leading >= indent &&
      !isListItem
    ) {
      // Continuation — join to previous line with a single space.
      out[out.length - 1] = out[out.length - 1].replace(/\s+$/, "") + " " + body.trimStart();
    } else {
      out.push(body);
    }
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
      assistantRaw.push(line.slice(assistantMarker.length));
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

  const unwrapped = unwrapWordWrap(assistantRaw, assistantMarker.length);
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
