---
type: Module
title: src/todo-manager.ts
description: Skeleton concept for src/todo-manager.ts (extracted; 9 symbols).
resource: src/todo-manager.ts
tags:
  - src
  - module
  - class
  - interface
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-02
explains:
  - src/todo-manager.ts#Todo
  - src/todo-manager.ts#TodoManager.cleanupSession
  - src/todo-manager.ts#TodoManager.formatTodoList
  - src/todo-manager.ts#TodoManager.getPriorityIcon
  - src/todo-manager.ts#TodoManager.getStatusChange
  - src/todo-manager.ts#TodoManager.hasSignificantChange
  - src/todo-manager.ts#TodoManager.updateTodos
stale: false
stale_reason: ""
graph_hash: d0d5217b5cdd1a8ac5b3c19460b09c3aa7a549e25c30c4a62a40ab119cb591eb
---

# Structure

## Exports
- `Todo` (interface, lines 3-8)
- `TodoManager` (class, lines 10-146)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `Todo` | interface | 3-8 | yes |
| `TodoManager` | class | 10-146 | yes |
| `TodoManager.cleanupSession` | method | 142-145 | yes |
| `TodoManager.formatTodoList` | method | 29-78 | yes |
| `TodoManager.getPriorityIcon` | method | 80-91 | yes |
| `TodoManager.getStatusChange` | method | 110-140 | yes |
| `TodoManager.getTodos` | method | 25-27 | yes |
| `TodoManager.hasSignificantChange` | method | 93-108 | yes |
| `TodoManager.updateTodos` | method | 14-23 | yes |

## Calls out
- `TodoManager.cleanupSession` → [Logger.debug](/src/logger.md)
- `TodoManager.formatTodoList` → `TodoManager.getPriorityIcon` (same file)
- `TodoManager.updateTodos` → [Logger.debug](/src/logger.md)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleTodoUpdate` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleTodoUpdate` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleTodoUpdate` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleTodoUpdate` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleTodoUpdate` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
A per-session, in-memory mirror of Claude Code's `TodoWrite` tool output, whose only purpose is rendering and incrementally updating a Slack message that shows the bot's current task list — it has no bearing on actual task execution, which claude itself drives. This exists because `TodoWrite` calls happen frequently during a single agentic turn, and posting a fresh Slack message on every call would be noisy; this module is the noise-reduction layer.

# Decisions
- (BACKFILL-slackbot-02) (1) `hasSignificantChange` intentionally ignores `content` and `priority` edits — it only fires on a task-count change or a status change. This is a deliberate tradeoff (reduce Slack noise from claude's frequent internal replanning) with a real cost: if claude silently rewords a pending task's description without changing its status, the Slack-visible list goes stale until the NEXT status-changing update happens to also refresh the wording. A future reader debugging "the todo list looks outdated" bugs should check this first. (2) Like `WorkingDirectoryManager`, state lives in a bare `Map<sessionId, Todo[]>` with no independent eviction — the only cleanup path is `cleanupSession`, which is the caller's responsibility to invoke (wired from `ClaudeHandler`'s inactive-session sweep via `SlackHandler`); if that wiring is ever removed or a new session-creation path is added that doesn't route through the same cleanup, todo entries leak for the life of the process. (3) The status→emoji table in `getStatusChange` and the priority→emoji table in `getPriorityIcon` are two independent, unrelated lookup structures that happen to look similar — a future engineer unifying "emoji lookup tables" in this file should notice they key off entirely different domains (status vs. priority) and are not interchangeable.

# Citations
[1] BACKFILL-slackbot-02 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot02-evidence.yml
