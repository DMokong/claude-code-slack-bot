---
type: Module
title: src/thread-state-manager.ts
description: Skeleton concept for src/thread-state-manager.ts (extracted; 12 symbols).
resource: src/thread-state-manager.ts
tags:
  - src
  - module
  - function
  - type
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-01
explains:
  - src/thread-state-manager.ts#getClaudeSessionId
  - src/thread-state-manager.ts#getThreadEntry
  - src/thread-state-manager.ts#hasExplicitThreadState
  - src/thread-state-manager.ts#loadState
  - src/thread-state-manager.ts#migrateRawEntries
  - src/thread-state-manager.ts#saveState
  - src/thread-state-manager.ts#setClaudeSessionId
  - src/thread-state-manager.ts#setEngine
stale: false
stale_reason: ""
graph_hash: 8a0d575a40873cd07242dedf282b03d07a103f46e0d9f41720eeb5c6f031704a
---

# Structure

## Exports
- `getClaudeSessionId` (function, lines 199-206)
- `getStatePath` (function, lines 18-20)
- `getThreadEntry` (function, lines 154-157)
- `hasExplicitThreadState` (function, lines 162-165)
- `loadState` (function, lines 65-130)
- `migrateRawEntries` (function, lines 35-56)
- `sanitizeCwd` (function, lines 26-28)
- `saveState` (function, lines 135-142)
- `setClaudeSessionId` (function, lines 185-194)
- `setEngine` (function, lines 170-180)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `RawStateMap` | type | 10-10 | no |
| `ThreadStateMap` | type | 9-9 | no |
| `getClaudeSessionId` | function | 199-206 | yes |
| `getStatePath` | function | 18-20 | yes |
| `getThreadEntry` | function | 154-157 | yes |
| `hasExplicitThreadState` | function | 162-165 | yes |
| `loadState` | function | 65-130 | yes |
| `migrateRawEntries` | function | 35-56 | yes |
| `sanitizeCwd` | function | 26-28 | yes |
| `saveState` | function | 135-142 | yes |
| `setClaudeSessionId` | function | 185-194 | yes |
| `setEngine` | function | 170-180 | yes |

## Calls out
- `getClaudeSessionId` → `loadState` (same file)
- `getThreadEntry` → `loadState` (same file)
- `hasExplicitThreadState` → `loadState` (same file)
- `loadState` → [Logger.error](/src/logger.md)
- `loadState` → `getStatePath` (same file)
- `loadState` → [Logger.info](/src/logger.md)
- `loadState` → `migrateRawEntries` (same file)
- `loadState` → `sanitizeCwd` (same file)
- `loadState` → `saveState` (same file)
- `migrateRawEntries` → [Logger.debug](/src/logger.md)
- `saveState` → [Logger.debug](/src/logger.md)
- `saveState` → `getStatePath` (same file)
- `setClaudeSessionId` → [Logger.debug](/src/logger.md)
- `setClaudeSessionId` → `loadState` (same file)
- `setClaudeSessionId` → `saveState` (same file)
- `setEngine` → [Logger.debug](/src/logger.md)
- `setEngine` → `loadState` (same file)
- `setEngine` → `saveState` (same file)

## Called by
- `ClaudeHandler._executeQuery` in [src/claude-handler.ts](/src/claude-handler.md)
- `ClaudeHandler.resolveSessionId` in [src/claude-handler.ts](/src/claude-handler.md)
- `resolveEngine` in [src/engine-router.ts](/src/engine-router.md)
- `resolveEngine` in [src/engine-router.ts](/src/engine-router.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
This is the durable, on-disk store backing both engine routing (engine-router.ts) and Claude session resumption (claude-handler.ts) for every Slack thread, keyed by the deterministic UUID v5 derived from thread_ts. It is the file a future reader should check first when debugging "the bot forgot which engine/session this thread was using" — the answer is usually in config/thread-state.json for the relevant working directory, not in any in-memory state.

# Decisions
- (BACKFILL-slackbot-01) State lives at <cwd>/config/thread-state.json — i.e. per working directory, not globally for the bot process — which means the same Slack thread can have independent engine/session state per project if its working directory changes; this is a natural consequence of cwd-scoped state but easy to overlook when debugging "engine mode didn't stick" if the working directory silently reset (see slack-handler.md's note that WorkingDirectoryManager itself doesn't persist cwd across restarts). Writes use a write-to-.tmp-then-rename pattern specifically to avoid a torn/partially-written JSON file if the process is killed mid-write — thread-state.json is read on nearly every message, so a corrupted file would break routing/resumption for every thread sharing that working directory, not just the one being written at the time. There are two distinct legacy-migration code paths layered into loadState: (1) in-place migration of flat `{threadId: sessionId}` string entries into full ThreadStateEntry objects (from an earlier, engine-less version of this file's own format), and (2) a one-time-per-process import of an even older ~/.claude/projects/{sanitized-cwd}/thread-session-map.json file (predating this module's existence entirely), which gets renamed to `.migrated` after import so it's never re-read. A future reader adding a third schema version should follow this same pattern (detect old shape, convert in loadState, mark the old source as consumed) rather than writing an ad hoc one-off migration script, since callers already assume loadState always returns the current ThreadStateMap shape. getClaudeSessionId returns null both for "this thread has no entry at all" and for "this thread has an entry but claude is null" — those two states are not distinguishable from this function's return value alone; only hasExplicitThreadState (which checks entry presence, not the claude field) can tell them apart.

# Citations
[1] BACKFILL-slackbot-01 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot01-evidence.yml
