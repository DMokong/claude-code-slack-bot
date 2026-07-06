---
type: Module
title: src/copilot-handler.ts
description: Skeleton concept for src/copilot-handler.ts (extracted; 3 symbols).
resource: src/copilot-handler.ts
tags:
  - src
  - module
  - class
  - function
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-01
explains:
  - src/copilot-handler.ts#CopilotHandler.query
  - src/copilot-handler.ts#extractTextFromLines
stale: false
stale_reason: ""
graph_hash: 182c4a76ac41fbb6fe303225cec8eeb326b319e5416f34834c8fa4503042e983
---

# Structure

## Exports
- `CopilotHandler` (class, lines 42-104)
- `extractTextFromLines` (function, lines 16-40)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `CopilotHandler` | class | 42-104 | yes |
| `CopilotHandler.query` | method | 43-103 | yes |
| `extractTextFromLines` | function | 16-40 | yes |

## Calls out
- `CopilotHandler.query` → `extractTextFromLines` (same file)
- `CopilotHandler.query` → [kill](/scripts/run-via-webterm.md)

## Called by
- `ClaudeHandler._executeQuery` in [src/claude-handler.ts](/src/claude-handler.md)
- `SlackHandler.sendCopilotResponse` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
This module isolates all interaction with the GitHub Copilot CLI behind a small Promise-returning API so the rest of the bot (slack-handler.ts, claude-handler.ts's rate-limit fallback) doesn't need to know anything about spawning processes or Copilot's JSONL wire format. It's the "other engine" half of the Claude/Copilot routing decision made in engine-router.ts.

# Decisions
- (BACKFILL-slackbot-01) Unlike the Claude Code SDK path, there is no session/resume concept here at all — every CopilotHandler.query call is a fresh, independent CLI invocation with `--yolo` (auto-approve) and JSON output; ConversationSession history from the Claude side is never passed to Copilot, which is exactly why slack-handler.ts shows a "context not available" warning on an engine switch rather than silently degrading. An exit code of 0 with no extractable text is treated as an error ("Copilot returned an empty response"), not a valid empty answer — this was a deliberate choice to surface CLI output-format drift or truncation as a loud failure rather than posting nothing to Slack and leaving the user wondering if the bot is broken. extractTextFromLines silently drops any line that fails JSON.parse rather than failing the whole extraction, because the Copilot CLI's JSON output mode can still emit non-JSON noise lines (e.g. leftover ANSI/colour codes) — a strict parser would make the whole feature fragile to CLI version changes in Copilot's own output hygiene. Aborting mid-request sends SIGTERM to the child process (not SIGKILL), giving the Copilot CLI a chance to exit cleanly; the `settled` flag exists specifically because both the abort listener and the process `close` handler can independently try to settle the same promise once a kill lands, and only the first one may win.

# Citations
[1] BACKFILL-slackbot-01 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot01-evidence.yml
