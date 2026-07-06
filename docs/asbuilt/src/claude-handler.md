---
type: Module
title: src/claude-handler.ts
description: Skeleton concept for src/claude-handler.ts (extracted; 10 symbols).
resource: src/claude-handler.ts
tags:
  - src
  - module
  - class
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-01
explains:
  - src/claude-handler.ts#ClaudeHandler
  - src/claude-handler.ts#ClaudeHandler._executeQuery
  - src/claude-handler.ts#ClaudeHandler.cleanupInactiveSessions
  - src/claude-handler.ts#ClaudeHandler.createSession
  - src/claude-handler.ts#ClaudeHandler.resolveSessionId
  - src/claude-handler.ts#ClaudeHandler.streamQuery
stale: false
stale_reason: ""
graph_hash: eca695496946f7f044ecd15540643dc5d7d83983eb7612677d398da52a748505
---

# Structure

## Exports
- `ClaudeHandler` (class, lines 11-204)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `ClaudeHandler` | class | 11-204 | yes |
| `ClaudeHandler._executeQuery` | method | 158-189 | yes |
| `ClaudeHandler.cleanupInactiveSessions` | method | 191-203 | yes |
| `ClaudeHandler.constructor` | method | 16-18 | yes |
| `ClaudeHandler.createSession` | method | 28-43 | yes |
| `ClaudeHandler.getProjectDir` | method | 49-52 | yes |
| `ClaudeHandler.getSession` | method | 24-26 | yes |
| `ClaudeHandler.getSessionKey` | method | 20-22 | yes |
| `ClaudeHandler.resolveSessionId` | method | 59-70 | yes |
| `ClaudeHandler.streamQuery` | method | 72-156 | yes |

## Calls out
- `ClaudeHandler._executeQuery` → [Logger.info](/src/logger.md)
- `ClaudeHandler._executeQuery` → [CopilotHandler.query](/src/copilot-handler.md)
- `ClaudeHandler._executeQuery` → [setClaudeSessionId](/src/thread-state-manager.md)
- `ClaudeHandler.cleanupInactiveSessions` → [Logger.info](/src/logger.md)
- `ClaudeHandler.createSession` → `ClaudeHandler.getSessionKey` (same file)
- `ClaudeHandler.createSession` → [Logger.info](/src/logger.md)
- `ClaudeHandler.createSession` → [threadToSessionId](/src/session-id.md)
- `ClaudeHandler.getSession` → `ClaudeHandler.getSessionKey` (same file)
- `ClaudeHandler.resolveSessionId` → [getClaudeSessionId](/src/thread-state-manager.md)
- `ClaudeHandler.resolveSessionId` → `ClaudeHandler.getProjectDir` (same file)
- `ClaudeHandler.resolveSessionId` → [Logger.warn](/src/logger.md)
- `ClaudeHandler.streamQuery` → `ClaudeHandler._executeQuery` (same file)
- `ClaudeHandler.streamQuery` → [Logger.debug](/src/logger.md)
- `ClaudeHandler.streamQuery` → [McpManager.getDefaultAllowedTools](/src/mcp-manager.md)
- `ClaudeHandler.streamQuery` → [McpManager.getServerConfiguration](/src/mcp-manager.md)
- `ClaudeHandler.streamQuery` → [Logger.info](/src/logger.md)
- `ClaudeHandler.streamQuery` → `ClaudeHandler.resolveSessionId` (same file)
- `ClaudeHandler.streamQuery` → [Logger.warn](/src/logger.md)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.setupEventHandlers` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
This module is the seam between Slack's per-thread mental model and the Claude Code SDK's own session model, which are not the same thing: the SDK generates its own opaque session UUID per invocation and has no concept of "resume this Slack thread." Everything in this file exists to bridge that gap deterministically so a Slack thread reliably resumes the right Claude Code session across multiple messages and even across bot restarts.

# Decisions
- (BACKFILL-slackbot-01) The SDK does not expose an options.sessionId you can set — it always mints its own UUID on `system`/`init` — so this module can't simply pass "resume this session" up front. Instead it maintains a mapping (persisted via thread-state-manager, keyed by a UUID v5 derived deterministically from thread_ts via threadToSessionId) from "the thread's own deterministic ID" to "whatever real SDK session ID got assigned last time," and only sets `options.resume` after confirming the corresponding `.jsonl` transcript file still exists on disk under ~/.claude/projects/{sanitized-cwd}/ — a mapping entry alone is not trusted, because the underlying session file can be pruned/missing independently of the mapping (e.g. manual cleanup, disk issues), and resuming a session ID whose file is gone throws inside the SDK. If a resume attempt still throws for some other reason, streamQuery retries exactly once with `options.resume` deleted rather than surfacing the error — the rejected alternative (surface the resume failure to the user as an error) would turn a broken-but-recoverable session into a hard failure for what a user would experience as "just talking in a thread," so the code trades a bit of context loss (this reply won't remember prior turns) for continuity of service. streamQuery also injects a system-prompt nudge on every single query asking Claude to proactively use the "remember" skill before finishing — the comment explains this exists because SessionEnd/PreCompact hooks (which would normally trigger memory writes) don't fire when the SDK is driven outside REPL mode, so this prompt-injection is a deliberate workaround for a gap in the SDK's hook surface, not a product feature in its own right; see claudeclaw/docs/plans/remember-hook-alternatives.md for other options that were considered.

# Citations
[1] BACKFILL-slackbot-01 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot01-evidence.yml
