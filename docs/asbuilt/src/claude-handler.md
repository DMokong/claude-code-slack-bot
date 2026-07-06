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
  - BACKFILL-slackbot-06
explains:
  - src/claude-handler.ts#ClaudeHandler
  - src/claude-handler.ts#ClaudeHandler._executeQuery
  - src/claude-handler.ts#ClaudeHandler.cleanupInactiveSessions
  - src/claude-handler.ts#ClaudeHandler.createSession
  - src/claude-handler.ts#ClaudeHandler.resolveSessionId
  - src/claude-handler.ts#ClaudeHandler.streamQuery
stale: false
stale_reason: ""
graph_hash: d0d5217b5cdd1a8ac5b3c19460b09c3aa7a549e25c30c4a62a40ab119cb591eb
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
ClaudeHandler bridges Slack's thread-oriented mental model to the Claude Code SDK's session model, which are not the same thing: the SDK mints its own opaque session UUID per invocation and has no concept of 'resume this Slack thread.' This file maintains an in-memory session map keyed by user+channel+thread and does the bookkeeping (via a mapping file owned by thread-state-manager) that lets a deterministic per-thread UUID resolve to whatever real SDK session ID got assigned last time, so a Slack thread reliably resumes the right session across multiple messages and even across bot restarts.

# Decisions
- (BACKFILL-slackbot-01) The SDK does not expose an options.sessionId you can set — it always mints its own UUID on `system`/`init` — so this module can't simply pass "resume this session" up front. Instead it maintains a mapping (persisted via thread-state-manager, keyed by a UUID v5 derived deterministically from thread_ts via threadToSessionId) from "the thread's own deterministic ID" to "whatever real SDK session ID got assigned last time," and only sets `options.resume` after confirming the corresponding `.jsonl` transcript file still exists on disk under ~/.claude/projects/{sanitized-cwd}/ — a mapping entry alone is not trusted, because the underlying session file can be pruned/missing independently of the mapping (e.g. manual cleanup, disk issues), and resuming a session ID whose file is gone throws inside the SDK. If a resume attempt still throws for some other reason, streamQuery retries exactly once with `options.resume` deleted rather than surfacing the error — the rejected alternative (surface the resume failure to the user as an error) would turn a broken-but-recoverable session into a hard failure for what a user would experience as "just talking in a thread," so the code trades a bit of context loss (this reply won't remember prior turns) for continuity of service. streamQuery also injects a system-prompt nudge on every single query asking Claude to proactively use the "remember" skill before finishing — the comment explains this exists because SessionEnd/PreCompact hooks (which would normally trigger memory writes) don't fire when the SDK is driven outside REPL mode, so this prompt-injection is a deliberate workaround for a gap in the SDK's hook surface, not a product feature in its own right; see claudeclaw/docs/plans/remember-hook-alternatives.md for other options that were considered.
- (BACKFILL-slackbot-06) 2026-07-06 (claw-3t2q item 4, commit d919df48): the permission-approval flow that streamQuery appeared to support at a glance is gone from the rest of the codebase, and the audit that removed it established WHY that was safe: streamQuery hardcodes permissionMode: 'bypassPermissions' on every single call, and no permissionPromptToolName was ever wired into the options object anywhere in this file's history — meaning the SDK never had a live path to fire a tool-use permission prompt in the first place. The only edit this file needed was a one-line comment correction ('Allow all MCP tools by default, plus permission prompt tool' -> 'Allow all MCP tools by default') because the OLD comment referenced a flow this file's logic never actually implemented. Separately, and this is the trap a future reader should not fall into: the 'slackContext' parameter (carrying {channel, threadTs, user}) living in the same function is UNRELATED to permissions despite the coincidental proximity — it was, and still is, live production wiring. Its channel/threadTs feed directly into the appendSystemPrompt string so Claude, inside an SDK-driven turn, knows which Slack channel it is replying in and can honor channel-specific protocols documented in CLAUDE.md (e.g. the #cc-ai discourse mode). Prior to the audit, a comment at the call site in slack-handler.ts mislabeled this as 'Create Slack context for permission prompts' — only that comment was wrong and got fixed; the behavior itself was never permission-related and was never touched. The resume-then-fallback pattern (streamQuery's catch around _executeQuery) is a deliberate reliability trade-off unrelated to this remediation: if a resume attempt throws for any reason, it retries exactly once with options.resume deleted rather than surfacing the error, trading conversational continuity (this one reply won't remember prior turns) for availability, since a hard failure would read to a Slack user as 'the bot is broken' for what is usually just a pruned or missing session transcript file.

# Citations
[1] BACKFILL-slackbot-01 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot01-evidence.yml
[2] BACKFILL-slackbot-06 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot06-evidence.yml
