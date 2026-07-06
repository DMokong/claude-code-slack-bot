---
type: Module
title: scripts/healthcheck-webterm-claude.ts
description: Skeleton concept for scripts/healthcheck-webterm-claude.ts
  (extracted; 13 symbols).
resource: scripts/healthcheck-webterm-claude.ts
tags:
  - scripts
  - module
  - function
  - interface
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-05
explains:
  - scripts/healthcheck-webterm-claude.ts#SseHandle
  - scripts/healthcheck-webterm-claude.ts#StepResult
  - scripts/healthcheck-webterm-claude.ts#createSession
  - scripts/healthcheck-webterm-claude.ts#killSession
  - scripts/healthcheck-webterm-claude.ts#main
  - scripts/healthcheck-webterm-claude.ts#resolveToken
  - scripts/healthcheck-webterm-claude.ts#sendInput
  - scripts/healthcheck-webterm-claude.ts#step
  - scripts/healthcheck-webterm-claude.ts#subscribeSse
  - scripts/healthcheck-webterm-claude.ts#waitForPromptReady
stale: false
stale_reason: ""
graph_hash: 8a0d575a40873cd07242dedf282b03d07a103f46e0d9f41720eeb5c6f031704a
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `SseHandle` | interface | 158-163 | no |
| `StepResult` | interface | 70-77 | no |
| `createSession` | function | 116-131 | no |
| `fetchGridText` | function | 150-154 | no |
| `infoLine` | function | 110-112 | no |
| `killSession` | function | 133-135 | no |
| `main` | function | 220-388 | no |
| `resolveToken` | function | 32-39 | no |
| `sendInput` | function | 137-148 | no |
| `sleep` | function | 214-216 | no |
| `step` | function | 88-108 | no |
| `subscribeSse` | function | 165-202 | no |
| `waitForPromptReady` | function | 204-212 | no |

## Calls out
- `main` → `createSession` (same file)
- `main` → [extractTurn](/src/webterm-claude-extractor.md)
- `main` → `fetchGridText` (same file)
- `main` → [formatTurnForSlack](/src/webterm-claude-extractor.md)
- `main` → `infoLine` (same file)
- `main` → `killSession` (same file)
- `main` → `sendInput` (same file)
- `main` → `sleep` (same file)
- `main` → `step` (same file)
- `main` → `subscribeSse` (same file)
- `main` → `waitForPromptReady` (same file)
- `sendInput` → `sleep` (same file)
- `waitForPromptReady` → `sleep` (same file)

# Explanation
This is a synthetic-transaction health check, not a unit test — it
drives one real turn through the exact chain of infrastructure the
production bot uses for every Slack-routed reply: webterm session
creation -> claude boot -> a scripted prompt -> the PRODUCTION
extractor (imported directly from src/webterm-claude-extractor.ts, not
reimplemented) -> Slack-formatted output. It's invoked on a 45-minute
timer by claudeclaw's scripts/healthcheck-webterm.sh, which posts the
failure tail to the #cc-logs Slack channel on nonzero exit. A future
reader should understand this script exists because webterm's
/api/health is liveness-only — it doesn't catch EXTRACTION breakage,
which has happened silently in production before when a claude TUI
auto-update changed its rendering format (gotcha #8), and the first
human to notice was Dustin seeing garbled replies.

# Decisions
- (BACKFILL-slackbot-05) (1) The retry loop in the "fetch grid + extract turn" step
(ETJ7_MAX_ATTEMPTS=3) exists because prompt-ready can fire prematurely
— the SSE event claims the terminal is idle, but the extractor
sometimes finds no assistant text yet (claw-etj7); the healthcheck
mirrors the bot's own retry-on-empty-extraction compensation rather
than treating one premature signal as a hard failure. (2) Even after a
non-empty extraction, the script re-polls up to 20 times waiting for
TWO CONSECUTIVE identical snapshots before trusting the content —
claude's TUI can still be mid-render (a "thinking pause" mid-response)
when prompt-ready fires, so a single non-empty read isn't proof the
answer is complete. (3) The final assertion checks the answer CONTAINS
an expected substring ("4" for "what is 2 plus 2?"), not that it
equals a fixed string — deliberately a sanity check, not a correctness
check, since claude's phrasing is non-deterministic; a human is
expected to eyeball a failure here rather than assume the pipeline is
broken. (4) DIRECT_SPAWN_CMD support mirrors a later production
capability (claude as the PTY child via argv, not typed into a shell)
added by epic claw-3btg — when set, the script skips typing a boot
command entirely and instead asserts the webterm server echoed back a
command[] array, catching a silent no-op from a misconfigured
WEBTERM_SPAWN_ALLOWLIST on the server side.

# Citations
[1] BACKFILL-slackbot-05 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot05-evidence.yml
