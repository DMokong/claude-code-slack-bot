---
type: Module
title: src/index.ts
description: Skeleton concept for src/index.ts (extracted; 2 symbols).
resource: src/index.ts
tags:
  - src
  - module
  - const
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-01
explains:
  - src/index.ts#gracefulShutdown
  - src/index.ts#start
stale: false
stale_reason: ""
graph_hash: 8a0d575a40873cd07242dedf282b03d07a103f46e0d9f41720eeb5c6f031704a
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `gracefulShutdown` | const | 61-71 | no |
| `start` | function | 16-95 | no |

## Calls out
- `gracefulShutdown` → [Logger.error](/src/logger.md)
- `gracefulShutdown` → [Logger.info](/src/logger.md)
- `start` → [ensureSingleInstance](/src/single-instance.md)
- `start` → [Logger.error](/src/logger.md)
- `start` → `gracefulShutdown` (same file)
- `start` → [Logger.info](/src/logger.md)
- `start` → [McpManager.loadConfiguration](/src/mcp-manager.md)
- `start` → [SlackHandler.setupEventHandlers](/src/slack-handler.md)
- `start` → `start` (same file)
- `start` → [validateConfig](/src/config.md)

# Explanation
This is the process entrypoint for the Slack bot — the file `bun`/`node` actually executes. It exists to sequence bootstrap in a very specific order (single-instance guard, then config validation, then Bolt app, then MCP manager, then the two handler classes, then event wiring, then app.start(), and only then signal handlers) and to own graceful shutdown. A future reader touching startup behavior needs to know that this ordering is not arbitrary — several steps have hard dependencies on the previous ones (ClaudeHandler needs the already-loaded McpManager; SlackHandler needs both already-constructed handlers).

# Decisions
- (BACKFILL-slackbot-01) Single-instance enforcement (ensureSingleInstance) runs before anything else, including config validation, because the failure mode it prevents — two bot processes on the same Slack token — corrupts shared on-disk state (thread-state.json) rather than just producing duplicate messages; that's why it gets its own dedicated exit code (EXIT_CODE_DUPLICATE_INSTANCE) instead of falling into the generic catch-all exit(1) branch, so launchd/process supervisors can distinguish "another instance owns this token" (an operator/config condition, don't crash-loop-restart) from an actual crash. Signal handlers are installed AFTER app.start() completes, not before — meaning a SIGTERM delivered during the brief window while Slack's socket-mode connection is still being established is not caught by gracefulShutdown and falls through to Node's default (immediate) exit behavior; this is presumably an accepted tradeoff since that window is short and the alternative (installing handlers before the app object even exists) would mean shutdown logic references were not yet in scope. gracefulShutdown deliberately calls slackHandler.shutdown() rather than tearing down webterm sessions itself — SlackHandler.shutdown leaves webterm sessions alive on purpose so the next bot process can adopt them by title, so index.ts's shutdown path is intentionally "thin" and defers all the interesting webterm-adoption logic to the handler layer.

# Citations
[1] BACKFILL-slackbot-01 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot01-evidence.yml
