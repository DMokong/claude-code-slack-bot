---
type: Module
title: src/slack-handler.ts
description: Skeleton concept for src/slack-handler.ts (extracted; 32 symbols).
resource: src/slack-handler.ts
tags:
  - src
  - module
  - class
  - function
  - interface
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-01
  - BACKFILL-slackbot-06
explains:
  - src/slack-handler.ts#SlackHandler
  - src/slack-handler.ts#SlackHandler.constructor
  - src/slack-handler.ts#SlackHandler.handleMessage
  - src/slack-handler.ts#SlackHandler.sendCopilotResponse
  - src/slack-handler.ts#SlackHandler.setupEventHandlers
  - src/slack-handler.ts#isRateLimitError
  - src/slack-handler.ts#parseEngineCommand
stale: false
stale_reason: ""
graph_hash: d0d5217b5cdd1a8ac5b3c19460b09c3aa7a549e25c30c4a62a40ab119cb591eb
---

# Structure

## Exports
- `SlackHandler` (class, lines 111-1299)
- `emojiToShortcode` (function, lines 42-54)
- `parseEngineCommand` (function, lines 64-77)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `MessageEvent` | interface | 94-109 | no |
| `SlackHandler` | class | 111-1299 | yes |
| `SlackHandler.constructor` | method | 128-156 | yes |
| `SlackHandler.createNewTodoMessage` | method | 1079-1095 | yes |
| `SlackHandler.extractTextContent` | method | 928-936 | yes |
| `SlackHandler.formatBashTool` | method | 1001-1003 | yes |
| `SlackHandler.formatEditTool` | method | 974-988 | yes |
| `SlackHandler.formatGenericTool` | method | 1005-1007 | yes |
| `SlackHandler.formatMessage` | method | 1234-1245 | yes |
| `SlackHandler.formatReadTool` | method | 997-999 | yes |
| `SlackHandler.formatToolUse` | method | 938-972 | yes |
| `SlackHandler.formatWriteTool` | method | 990-995 | yes |
| `SlackHandler.getBotUserId` | method | 1186-1197 | yes |
| `SlackHandler.getImageUploader` | method | 169-174 | yes |
| `SlackHandler.getToolStatusDescription` | method | 881-919 | yes |
| `SlackHandler.handleChannelJoin` | method | 1199-1232 | yes |
| `SlackHandler.handleMessage` | method | 176-801 | yes |
| `SlackHandler.handleTodoUpdate` | method | 1020-1077 | yes |
| `SlackHandler.handleTodoWrite` | method | 1015-1018 | yes |
| `SlackHandler.isMcpInfoCommand` | method | 1178-1180 | yes |
| `SlackHandler.isMcpReloadCommand` | method | 1182-1184 | yes |
| `SlackHandler.sendCopilotResponse` | method | 803-838 | yes |
| `SlackHandler.setThreadStatus` | method | 845-875 | yes |
| `SlackHandler.setupEventHandlers` | method | 1247-1298 | yes |
| `SlackHandler.shortenPath` | method | 921-926 | yes |
| `SlackHandler.shutdown` | method | 163-167 | yes |
| `SlackHandler.truncateString` | method | 1009-1013 | yes |
| `SlackHandler.updateMessageReaction` | method | 1097-1155 | yes |
| `SlackHandler.updateTaskProgressReaction` | method | 1157-1176 | yes |
| `emojiToShortcode` | function | 42-54 | yes |
| `isRateLimitError` | function | 79-88 | no |
| `parseEngineCommand` | function | 64-77 | yes |

## Calls out
- `SlackHandler.constructor` → [Logger.info](/src/logger.md)
- `SlackHandler.createNewTodoMessage` → [Logger.debug](/src/logger.md)
- `SlackHandler.formatEditTool` → `SlackHandler.truncateString` (same file)
- `SlackHandler.formatToolUse` → `SlackHandler.formatBashTool` (same file)
- `SlackHandler.formatToolUse` → `SlackHandler.formatEditTool` (same file)
- `SlackHandler.formatToolUse` → `SlackHandler.formatGenericTool` (same file)
- `SlackHandler.formatToolUse` → `SlackHandler.formatReadTool` (same file)
- `SlackHandler.formatToolUse` → `SlackHandler.formatWriteTool` (same file)
- `SlackHandler.formatToolUse` → `SlackHandler.handleTodoWrite` (same file)
- `SlackHandler.formatWriteTool` → `SlackHandler.truncateString` (same file)
- `SlackHandler.getBotUserId` → [Logger.error](/src/logger.md)
- `SlackHandler.getToolStatusDescription` → `SlackHandler.shortenPath` (same file)
- `SlackHandler.getToolStatusDescription` → `SlackHandler.truncateString` (same file)
- `SlackHandler.handleChannelJoin` → [Logger.error](/src/logger.md)
- `SlackHandler.handleChannelJoin` → [Logger.info](/src/logger.md)
- `SlackHandler.handleMessage` → [SlackStreamManager.append](/src/slack-streamer.md)
- `SlackHandler.handleMessage` → [TodoManager.cleanupSession](/src/todo-manager.md)
- `SlackHandler.handleMessage` → [FileHandler.cleanupTempFiles](/src/file-handler.md)
- `SlackHandler.handleMessage` → [SlackStreamManager.consumeFallbackText](/src/slack-streamer.md)
- `SlackHandler.handleMessage` → [Logger.debug](/src/logger.md)
- `SlackHandler.handleMessage` → [FileHandler.downloadAndProcessFiles](/src/file-handler.md)
- `SlackHandler.handleMessage` → [Logger.error](/src/logger.md)
- `SlackHandler.handleMessage` → [ImageUploader.extractImagePaths](/src/image-uploader.md)
- `SlackHandler.handleMessage` → `SlackHandler.extractTextContent` (same file)
- `SlackHandler.handleMessage` → [WorkingDirectoryManager.formatDirectoryMessage](/src/working-directory-manager.md)
- `SlackHandler.handleMessage` → [FileHandler.formatFilePrompt](/src/file-handler.md)
- `SlackHandler.handleMessage` → [McpManager.formatMcpInfo](/src/mcp-manager.md)
- `SlackHandler.handleMessage` → `SlackHandler.formatMessage` (same file)
- `SlackHandler.handleMessage` → `SlackHandler.formatToolUse` (same file)
- `SlackHandler.handleMessage` → `SlackHandler.getImageUploader` (same file)
- `SlackHandler.handleMessage` → [ClaudeHandler.getSession](/src/claude-handler.md)
- `SlackHandler.handleMessage` → [ClaudeHandler.getSessionKey](/src/claude-handler.md)
- `SlackHandler.handleMessage` → [getThreadEntry](/src/thread-state-manager.md)
- `SlackHandler.handleMessage` → `SlackHandler.getToolStatusDescription` (same file)
- `SlackHandler.handleMessage` → [WorkingDirectoryManager.getWorkingDirectory](/src/working-directory-manager.md)
- `SlackHandler.handleMessage` → `SlackHandler.handleMessage` (same file)
- `SlackHandler.handleMessage` → `SlackHandler.handleTodoUpdate` (same file)
- `SlackHandler.handleMessage` → [WorkingDirectoryManager.hasChannelWorkingDirectory](/src/working-directory-manager.md)
- `SlackHandler.handleMessage` → [Logger.info](/src/logger.md)
- `SlackHandler.handleMessage` → [WorkingDirectoryManager.isGetCommand](/src/working-directory-manager.md)
- `SlackHandler.handleMessage` → [ImageUploader.isImagePath](/src/image-uploader.md)
- `SlackHandler.handleMessage` → `SlackHandler.isMcpInfoCommand` (same file)
- `SlackHandler.handleMessage` → `SlackHandler.isMcpReloadCommand` (same file)
- `SlackHandler.handleMessage` → `isRateLimitError` (same file)
- `SlackHandler.handleMessage` → `parseEngineCommand` (same file)
- `SlackHandler.handleMessage` → [WorkingDirectoryManager.parseSetCommand](/src/working-directory-manager.md)
- `SlackHandler.handleMessage` → [McpManager.reloadConfiguration](/src/mcp-manager.md)
- `SlackHandler.handleMessage` → [SlackStreamManager.reset](/src/slack-streamer.md)
- `SlackHandler.handleMessage` → [resolveEngine](/src/engine-router.md)
- `SlackHandler.handleMessage` → `SlackHandler.sendCopilotResponse` (same file)
- `SlackHandler.handleMessage` → [setEngine](/src/thread-state-manager.md)
- `SlackHandler.handleMessage` → `SlackHandler.setThreadStatus` (same file)
- `SlackHandler.handleMessage` → [WorkingDirectoryManager.setWorkingDirectory](/src/working-directory-manager.md)
- `SlackHandler.handleMessage` → [SlackStreamManager.stop](/src/slack-streamer.md)
- `SlackHandler.handleMessage` → [ClaudeHandler.streamQuery](/src/claude-handler.md)
- `SlackHandler.handleMessage` → [stripTransportSuffix](/src/webterm-runtime-handler.md)
- `SlackHandler.handleMessage` → [threadToSessionId](/src/session-id.md)
- `SlackHandler.handleMessage` → `SlackHandler.updateMessageReaction` (same file)
- `SlackHandler.handleMessage` → [ImageUploader.uploadImages](/src/image-uploader.md)
- `SlackHandler.handleMessage` → [Logger.warn](/src/logger.md)
- `SlackHandler.handleMessage` → [withQuerySpan](/src/telemetry.md)
- `SlackHandler.handleMessage` → [withThreadLock](/src/thread-lock.md)
- `SlackHandler.handleTodoUpdate` → `SlackHandler.createNewTodoMessage` (same file)
- `SlackHandler.handleTodoUpdate` → [Logger.debug](/src/logger.md)
- `SlackHandler.handleTodoUpdate` → [TodoManager.formatTodoList](/src/todo-manager.md)
- `SlackHandler.handleTodoUpdate` → [TodoManager.getStatusChange](/src/todo-manager.md)
- `SlackHandler.handleTodoUpdate` → [TodoManager.getTodos](/src/todo-manager.md)
- `SlackHandler.handleTodoUpdate` → [TodoManager.hasSignificantChange](/src/todo-manager.md)
- `SlackHandler.handleTodoUpdate` → `SlackHandler.updateTaskProgressReaction` (same file)
- `SlackHandler.handleTodoUpdate` → [TodoManager.updateTodos](/src/todo-manager.md)
- `SlackHandler.handleTodoUpdate` → [Logger.warn](/src/logger.md)
- `SlackHandler.sendCopilotResponse` → [Logger.error](/src/logger.md)
- `SlackHandler.sendCopilotResponse` → [CopilotHandler.query](/src/copilot-handler.md)
- `SlackHandler.sendCopilotResponse` → `SlackHandler.updateMessageReaction` (same file)
- `SlackHandler.setThreadStatus` → [Logger.info](/src/logger.md)
- `SlackHandler.setThreadStatus` → [Logger.warn](/src/logger.md)
- `SlackHandler.setupEventHandlers` → [ClaudeHandler.cleanupInactiveSessions](/src/claude-handler.md)
- `SlackHandler.setupEventHandlers` → [Logger.debug](/src/logger.md)
- `SlackHandler.setupEventHandlers` → `SlackHandler.getBotUserId` (same file)
- `SlackHandler.setupEventHandlers` → `SlackHandler.handleChannelJoin` (same file)
- `SlackHandler.setupEventHandlers` → `SlackHandler.handleMessage` (same file)
- `SlackHandler.setupEventHandlers` → [Logger.info](/src/logger.md)
- `SlackHandler.shutdown` → `SlackHandler.shutdown` (same file)
- `SlackHandler.updateMessageReaction` → [Logger.debug](/src/logger.md)
- `SlackHandler.updateMessageReaction` → `emojiToShortcode` (same file)
- `SlackHandler.updateMessageReaction` → [remove](/src/single-instance.md)
- `SlackHandler.updateMessageReaction` → [Logger.warn](/src/logger.md)
- `SlackHandler.updateTaskProgressReaction` → `SlackHandler.updateMessageReaction` (same file)

## Called by
- `start` in [src/index.ts](/src/index.ts.md)

# Explanation
SlackHandler is the message-routing brain of the bot — for every inbound Slack event it decides which of three very different execution paths handles it (the persistent webterm-driven Claude REPL, the classic claude -p SDK streaming path, or GitHub Copilot), and it owns every Slack-visible side effect along the way: typing-status text, emoji reactions, streamed or batched replies, todo-list messages, image uploads, and file-route acknowledgements.

# Decisions
- (BACKFILL-slackbot-01) The webterm-routing check happens near the very top of handleMessage, but it explicitly excludes messages carrying files AND explicitly excludes cwd/mcp bot-level commands — a code comment states this exclusion was added because "routeAll was swallowing them into claude," meaning an earlier version of this routing check had a real production bug where WEBTERM_ROUTE_ALL=1 silently broke `cwd` and `mcp` commands by sending them into the webterm's interactive Claude session instead of handling them as bot commands. Engine choice (Claude vs Copilot) is only persisted to disk when setBy is 'manual' or 'auto-fallback' — channel-default and global-default resolutions are deliberately left unpersisted so that editing config/channel- engine.json takes effect on the next message rather than being frozen by a stale persisted value from the first message in a thread; this is easy to get wrong when adding a new engine-resolution source, since the natural instinct is "resolve once, persist always." The Copilot path bypasses withThreadLock entirely (only the Claude SDK path is serialized per-thread) — Copilot's CLI invocation is a single request/response with no resumable session state to protect, so there was no correctness reason to lock it, but this does mean a user who rapid-fires multiple messages in "copilot mode" can have out-of-order Copilot replies land in Slack, unlike the Claude path where the lock guarantees in-order delivery. Working directory resolution (WorkingDirectoryManager) that gates almost the entire flow is in-memory only — it is never persisted to thread-state.json or any other file — so a bot restart silently forgets every cwd a user has set for a channel or thread, and users have to re-run `cwd /path/to/project` after every deploy; this is worth knowing before "fixing" what looks like an intermittent cwd bug that's actually just "the bot restarted."
- (BACKFILL-slackbot-06) 2026-07-06 (claw-3t2q item 4, commit d919df48): the two Slack app.action handlers for 'approve_tool' and 'deny_tool' — interactive-button click handlers that would ack(), resolve a pending approval on a module-level permissionServer, and post an ephemeral confirmation — have been deleted from setupEventHandlers, along with the top-of-file 'import { permissionServer } from ./permission-mcp-server'. The audit that removed them established they were listeners for events that could never fire: nothing in claude-handler.ts ever configures a permissionPromptToolName, so the SDK never emits the tool-use permission request these buttons were built to answer, and permission-mcp-server.ts's corresponding sender half was equally dead. A future reader will not find approve_tool/deny_tool registrations anywhere in this file anymore, nor the permission-mcp-server module itself (deleted in full) — if interactive tool-approval is wanted in the future it needs to be built and wired end-to-end from scratch, not resurrected from deleted code. The 'slackContext' object built just before the streamQuery call (channel/threadTs/user) is unchanged in behavior; only its adjacent comment was corrected to describe its real purpose (see the paired note in claude-handler.md's enrichment draft) — it feeds channel-specific system-prompt protocols, not permissions. Carried forward from before this remediation and still true: the webterm-routing check near the top of handleMessage explicitly excludes messages with files and explicitly excludes cwd/mcp bot-level commands, because an earlier version of WEBTERM_ROUTE_ALL=1 swallowed those commands into the interactive Claude session instead of handling them as bot commands — a real production bug that predates this audit window. Unrelated finding surfaced while auditing this remediation: src/permission-server-start.js (a plain launcher script, require('./permission-mcp-server.ts')) was left behind by the same permission-flow removal and now points at a file that no longer exists; nothing in package.json's scripts or src/index.ts invokes it, so it is dead weight rather than a live bug, but a future reader grepping 'permission' in this codebase should not assume it still does anything.

# Citations
[1] BACKFILL-slackbot-01 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot01-evidence.yml
[2] BACKFILL-slackbot-06 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot06-evidence.yml
