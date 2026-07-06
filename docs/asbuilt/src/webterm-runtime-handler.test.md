---
type: Module
title: src/webterm-runtime-handler.test.ts
description: Skeleton concept for src/webterm-runtime-handler.test.ts
  (extracted; 27 symbols).
resource: src/webterm-runtime-handler.test.ts
tags:
  - src
  - module
  - const
  - function
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-04
explains:
  - src/webterm-runtime-handler.test.ts#makeMockWebterm
  - src/webterm-runtime-handler.test.ts#makeSlack
stale: false
stale_reason: ""
graph_hash: 9759b135c07f30574b7bf7d243258420038465ac1a4c3772e3f14e18ef5df067
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `anyMessageContains` | const | 1268-1269 | no |
| `bootTo` | function | 1039-1046 | no |
| `bootTo` | function | 1236-1243 | no |
| `buildBootGrid` | function | 215-227 | no |
| `buildTurnGrid` | function | 229-245 | no |
| `cancel` | method | 59-59 | no |
| `emitExit` | method | 146-154 | no |
| `emitPromptReady` | method | 140-145 | no |
| `fetchImpl` | const | 26-134 | no |
| `flaky` | const | 530-536 | no |
| `flaky` | const | 705-711 | no |
| `idleLooking` | const | 1252-1261 | no |
| `iterate` | function | 1246-1250 | no |
| `load` | const | 1328-1335 | no |
| `makeMockWebterm` | function | 7-180 | no |
| `makeSlack` | function | 182-213 | no |
| `onlySessionId` | method | 174-178 | no |
| `seedSession` | method | 171-173 | no |
| `setLastOutputMs` | method | 161-165 | no |
| `setScrollback` | method | 166-170 | no |
| `setText` | method | 155-160 | no |
| `sleep` | function | 1617-1619 | no |
| `start` | method | 58-58 | no |
| `textFetches` | const | 1234-1234 | no |
| `waitFor` | function | 1608-1615 | no |
| `working` | const | 969-975 | no |
| `working` | const | 1150-1155 | no |

## Calls out
- `bootTo` → `emitPromptReady` (same file)
- `bootTo` → `onlySessionId` (same file)
- `bootTo` → `waitFor` (same file)
- `flaky` → `fetchImpl` (same file)
- `iterate` → `emitPromptReady` (same file)
- `iterate` → `textFetches` (same file)
- `iterate` → `waitFor` (same file)
- `waitFor` → `sleep` (same file)

# Explanation
This is the orchestration layer that keeps a persistent interactive `claude` REPL alive per Slack thread inside webterm, as an alternative to the `claude -p` SDK path that reinitializes MCP/permissions/context on every single message. A future reader should understand the durability model first: the webterm session's TITLE (`slack-bot <channel>::<thread>`) IS the thread→session map, not an in-process data structure — so a bot restart can find and adopt a surviving session by title rather than losing the conversation, which is why `shutdown()` leaves sessions alive by default.

# Decisions
- (BACKFILL-slackbot-04) Several non-obvious timing constants exist because of empirically observed claude TUI behavior, not theory: `DEFAULT_PASTE_SETTLE_MS` (1000ms) exists because claude aggregates an Enter arriving immediately after a bracketed paste into the paste itself, silently swallowing the submit — verified live that <600ms never submits and 1000ms reliably does. The wedged-session guard uses a SLIDING inactivity window (grid hasn't changed in N minutes) rather than a fixed per-turn timeout, because long agentic tasks can legitimately run for many minutes as long as the grid keeps changing; a fixed cap would kill valid long-running turns. `shutdown()` marks sessions dead locally and drains in-flight turns for up to `SHUTDOWN_DRAIN_MS` before returning, rather than just tearing down immediately, because Slack's Events API already acked the triggering message the instant it arrived — if the reply is dropped here, it is gone forever, not redelivered. Direct-spawn mode (`directSpawnCommand`) exists as a structural fix for the H1 hazard (claude dying inside a wrapping shell, leaving a bare shell that would EXECUTE the next Slack message as a command): making claude the literal PTY child removes the shell layer entirely rather than relying on the runtime detection heuristic (`CLAUDE_CHROME_RE` against the model-status row) as the only defense.

# Citations
[1] BACKFILL-slackbot-04 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot04-evidence.yml
