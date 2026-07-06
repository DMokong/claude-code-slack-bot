---
type: Module
title: src/thread-state-manager.test.ts
description: Skeleton concept for src/thread-state-manager.test.ts (extracted; 1 symbols).
resource: src/thread-state-manager.test.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-04
explains:
  - src/thread-state-manager.test.ts#statePath
stale: false
stale_reason: ""
graph_hash: 8a0d575a40873cd07242dedf282b03d07a103f46e0d9f41720eeb5c6f031704a
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `statePath` | function | 24-26 | no |

# Explanation
Documents the per-thread state file (`config/thread-state.json`) and its two migration paths for a future reader: (1) an intra-format migration from the flat `{threadId: sessionId}` string map that predates multi-engine support, to today's `{claude, copilot, engine, setBy}` object per thread; (2) a cross-file migration from a legacy Claude Code artifact at `~/.claude/projects/{sanitized-cwd}/thread-session-map.json` that existed before this bot maintained its own state file at all. Both migrations are automatic, on-read, and one-time (checked once per cwd per process for the legacy file, via the in-memory `legacyMigrationChecked` Set).

# Decisions
- (BACKFILL-slackbot-04) Storing BOTH `claude` and `copilot` session ids in one entry (rather than one active-session field keyed by whatever `engine` currently is) is the load-bearing design choice: it's what lets `setEngine` switch a thread's active backend without discarding the other backend's resumable conversation, so a user can bounce between engines mid-thread-history without losing context on either side. The legacy file is renamed to `<path>.migrated` rather than deleted after migration — a future reader should not assume the absence of `thread-session-map.json` means "never existed" versus "already migrated"; check for the `.migrated` sibling before concluding the former. `saveState` writes to a `.tmp` path and `renameSync`s over the real path — a crash mid-write leaves the old state.json intact rather than a half-written JSON file, at the cost of the write not being atomic across the two file operations on all filesystems.

# Citations
[1] BACKFILL-slackbot-04 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot04-evidence.yml
