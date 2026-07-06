---
type: Module
title: src/logger.ts
description: Skeleton concept for src/logger.ts (extracted; 10 symbols).
resource: src/logger.ts
tags:
  - src
  - module
  - class
  - function
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-03
explains:
  - src/logger.ts#Logger
  - src/logger.ts#Logger.constructor
  - src/logger.ts#Logger.debug
  - src/logger.ts#Logger.error
  - src/logger.ts#Logger.formatMessage
  - src/logger.ts#Logger.info
  - src/logger.ts#Logger.warn
  - src/logger.ts#emitToFile
  - src/logger.ts#resolveLogDir
  - src/logger.ts#todayKey
stale: false
stale_reason: ""
graph_hash: 8a0d575a40873cd07242dedf282b03d07a103f46e0d9f41720eeb5c6f031704a
---

# Structure

## Exports
- `Logger` (class, lines 63-110)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `Logger` | class | 63-110 | yes |
| `Logger.constructor` | method | 66-68 | yes |
| `Logger.debug` | method | 80-86 | yes |
| `Logger.error` | method | 100-109 | yes |
| `Logger.formatMessage` | method | 70-78 | yes |
| `Logger.info` | method | 88-92 | yes |
| `Logger.warn` | method | 94-98 | yes |
| `emitToFile` | function | 42-61 | no |
| `resolveLogDir` | function | 25-29 | no |
| `todayKey` | function | 34-40 | no |

## Calls out
- `Logger.debug` → `emitToFile` (same file)
- `Logger.debug` → `Logger.formatMessage` (same file)
- `Logger.debug` → [log](/scripts/run-via-webterm.md)
- `Logger.error` → `emitToFile` (same file)
- `Logger.error` → `Logger.error` (same file)
- `Logger.error` → `Logger.formatMessage` (same file)
- `Logger.info` → `emitToFile` (same file)
- `Logger.info` → `Logger.formatMessage` (same file)
- `Logger.info` → [log](/scripts/run-via-webterm.md)
- `Logger.warn` → `emitToFile` (same file)
- `Logger.warn` → `Logger.formatMessage` (same file)
- `Logger.warn` → `Logger.warn` (same file)
- `emitToFile` → `resolveLogDir` (same file)
- `emitToFile` → `todayKey` (same file)
- `emitToFile` → `Logger.warn` (same file)

## Called by
- `ClaudeHandler._executeQuery` in [src/claude-handler.ts](/src/claude-handler.md)
- `ClaudeHandler.cleanupInactiveSessions` in [src/claude-handler.ts](/src/claude-handler.md)
- `ClaudeHandler.createSession` in [src/claude-handler.ts](/src/claude-handler.md)
- `ClaudeHandler.resolveSessionId` in [src/claude-handler.ts](/src/claude-handler.md)
- `ClaudeHandler.streamQuery` in [src/claude-handler.ts](/src/claude-handler.md)
- `ClaudeHandler.streamQuery` in [src/claude-handler.ts](/src/claude-handler.md)
- `ClaudeHandler.streamQuery` in [src/claude-handler.ts](/src/claude-handler.md)
- `loadChannelMap` in [src/config.ts](/src/config.md)
- `getChannelDefault` in [src/engine-router.ts](/src/engine-router.md)
- `FileHandler.cleanupTempFiles` in [src/file-handler.ts](/src/file-handler.md)
- `FileHandler.cleanupTempFiles` in [src/file-handler.ts](/src/file-handler.md)
- `FileHandler.downloadAndProcessFiles` in [src/file-handler.ts](/src/file-handler.md)
- `FileHandler.downloadAndProcessFiles` in [src/file-handler.ts](/src/file-handler.md)
- `FileHandler.downloadFile` in [src/file-handler.ts](/src/file-handler.md)
- `FileHandler.downloadFile` in [src/file-handler.ts](/src/file-handler.md)
- `FileHandler.downloadFile` in [src/file-handler.ts](/src/file-handler.md)
- `FileHandler.downloadFile` in [src/file-handler.ts](/src/file-handler.md)
- `ImageUploader.uploadImage` in [src/image-uploader.ts](/src/image-uploader.md)
- `ImageUploader.uploadImage` in [src/image-uploader.ts](/src/image-uploader.md)
- `ImageUploader.uploadImage` in [src/image-uploader.ts](/src/image-uploader.md)
- `ImageUploader.uploadImages` in [src/image-uploader.ts](/src/image-uploader.md)
- `gracefulShutdown` in [src/index.ts](/src/index.ts.md)
- `gracefulShutdown` in [src/index.ts](/src/index.ts.md)
- `start` in [src/index.ts](/src/index.ts.md)
- `start` in [src/index.ts](/src/index.ts.md)
- `McpManager.loadConfiguration` in [src/mcp-manager.ts](/src/mcp-manager.md)
- `McpManager.loadConfiguration` in [src/mcp-manager.ts](/src/mcp-manager.md)
- `McpManager.loadConfiguration` in [src/mcp-manager.ts](/src/mcp-manager.md)
- `McpManager.validateServerConfig` in [src/mcp-manager.ts](/src/mcp-manager.md)
- `ensureSingleInstance` in [src/single-instance.ts](/src/single-instance.md)
- `ensureSingleInstance` in [src/single-instance.ts](/src/single-instance.md)
- `findOtherInstances` in [src/single-instance.ts](/src/single-instance.md)
- `killInstance` in [src/single-instance.ts](/src/single-instance.md)
- `SlackHandler.constructor` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.createNewTodoMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.getBotUserId` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleChannelJoin` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleChannelJoin` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleTodoUpdate` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleTodoUpdate` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.sendCopilotResponse` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.setThreadStatus` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.setThreadStatus` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.setupEventHandlers` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.setupEventHandlers` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.updateMessageReaction` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.updateMessageReaction` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackStreamManager.append` in [src/slack-streamer.ts](/src/slack-streamer.md)
- `SlackStreamManager.append` in [src/slack-streamer.ts](/src/slack-streamer.md)
- `SlackStreamManager.stop` in [src/slack-streamer.ts](/src/slack-streamer.md)
- `withThreadLock` in [src/thread-lock.ts](/src/thread-lock.md)
- `loadState` in [src/thread-state-manager.ts](/src/thread-state-manager.md)
- `loadState` in [src/thread-state-manager.ts](/src/thread-state-manager.md)
- `migrateRawEntries` in [src/thread-state-manager.ts](/src/thread-state-manager.md)
- `saveState` in [src/thread-state-manager.ts](/src/thread-state-manager.md)
- `setClaudeSessionId` in [src/thread-state-manager.ts](/src/thread-state-manager.md)
- `setEngine` in [src/thread-state-manager.ts](/src/thread-state-manager.md)
- `TodoManager.cleanupSession` in [src/todo-manager.ts](/src/todo-manager.md)
- `TodoManager.updateTodos` in [src/todo-manager.ts](/src/todo-manager.md)
- `WebtermRuntimeHandler.checkInputResponse` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.completeBootHandshake` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.constructor` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.createSession` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.deliverReply` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.handleMessage` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.handleMessage` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.postFreshStreamMessage` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.postReply` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.postStatusPlaceholder` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.reapIdleSessions` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.runSseListener` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.runSseListener` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.runStatusLoop` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.takeTurn` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.tryAdoptSession` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.tryAdoptSession` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.updateStreamMessage` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WorkingDirectoryManager.getWorkingDirectory` in [src/working-directory-manager.ts](/src/working-directory-manager.md)
- `WorkingDirectoryManager.removeWorkingDirectory` in [src/working-directory-manager.ts](/src/working-directory-manager.md)
- `WorkingDirectoryManager.resolveDirectory` in [src/working-directory-manager.ts](/src/working-directory-manager.md)
- `WorkingDirectoryManager.setWorkingDirectory` in [src/working-directory-manager.ts](/src/working-directory-manager.md)
- `WorkingDirectoryManager.setWorkingDirectory` in [src/working-directory-manager.ts](/src/working-directory-manager.md)
- `WorkingDirectoryManager.setWorkingDirectory` in [src/working-directory-manager.ts](/src/working-directory-manager.md)

# Explanation
This is the shared logging substrate for the entire bot - every other
module in `src/` gets its own `Logger` instance tagged with a context
string, but all instances funnel through the same module-level
file-writing state (`emitToFile`, `lastEnsuredDir`,
`fileLoggingDisabled`). It exists to answer two operational questions
reliably: "what did the bot do today" (via the daily-rotating file) and
"is there more than one bot instance running against these logs" (which
the file's own header comment identifies as the actual motivating bug).

# Decisions
- (BACKFILL-slackbot-03) The daily-rotation-by-recompute-at-write-time design (rather than
picking a filename once at startup) exists specifically to fix a
duplicate-instance blind spot: a stale long-lived process used to keep
writing into the file named for the day it *started*, so "today's log"
silently excluded output from a zombie instance. If you're ever tempted
to cache `todayKey()` for performance, don't - the whole point is that
it's recomputed on every write. `fileLoggingDisabled` is a one-way
latch: the first file-write failure (permissions, disk full, whatever)
permanently disables file logging for the rest of the process's
lifetime with no retry - a transient disk-full blip during a launchd
restart window would silently blind file logs until the next restart,
while console output (and hence `launchctl`/journald-captured stdout, if
any) keeps working. `SLACK_BOT_LOG_DIR=off` is the escape hatch for
setups (launchd, nohup) that already redirect stdout into a dated file
themselves - forgetting this exists is how you end up with two nearly
identical log files for the same day. `debug()` is the only level
gated on `config.debug`; if a bug report says "I don't see DEBUG lines
in the log file," check `config.debug` (which reads `DEBUG=true` or
`NODE_ENV=development`) before assuming file logging itself is broken.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
