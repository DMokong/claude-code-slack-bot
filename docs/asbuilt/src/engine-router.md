---
type: Module
title: src/engine-router.ts
description: Skeleton concept for src/engine-router.ts (extracted; 3 symbols).
resource: src/engine-router.ts
tags:
  - src
  - module
  - function
  - interface
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-01
explains:
  - src/engine-router.ts#EngineResolution
  - src/engine-router.ts#getChannelDefault
  - src/engine-router.ts#resolveEngine
stale: false
stale_reason: ""
graph_hash: eca695496946f7f044ecd15540643dc5d7d83983eb7612677d398da52a748505
---

# Structure

## Exports
- `EngineResolution` (interface, lines 9-12)
- `resolveEngine` (function, lines 18-37)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `EngineResolution` | interface | 9-12 | yes |
| `getChannelDefault` | function | 39-51 | no |
| `resolveEngine` | function | 18-37 | yes |

## Calls out
- `getChannelDefault` → [Logger.warn](/src/logger.md)
- `resolveEngine` → `getChannelDefault` (same file)
- `resolveEngine` → [getThreadEntry](/src/thread-state-manager.md)
- `resolveEngine` → [hasExplicitThreadState](/src/thread-state-manager.md)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
This module is the single source of truth for "which AI engine (Claude or GitHub Copilot) handles this thread right now," and it exists as its own file — separate from thread-state-manager.ts, which actually stores the persisted choice — so the resolution *policy* (thread override beats channel default beats global default) is testable and reviewable independent of the storage format.

# Decisions
- (BACKFILL-slackbot-01) The three-level fallback order (thread -> channel -> global) is fixed and not configurable; a future reader adding a fourth level (e.g. a per-user default) needs to insert it at the right point in this priority chain, not just add a new lookup. getChannelDefault reads config/channel-engine.json fresh from disk on every call rather than caching it — every message resolution does a file stat/read — which is a deliberate simplicity-over-throughput tradeoff so that editing the file takes effect on the very next message with no reload mechanism needed, at the cost of a filesystem hit per message when no thread-level override exists. Any malformed or missing channel-engine.json, or a value that isn't exactly the string 'copilot' or 'claude', is treated identically to "no channel default configured" (returns null and falls through to the global default) rather than raising — engine misrouting was judged worse than a loud failure here, so bad config degrades silently to the always-Claude global default instead of blocking messages.

# Citations
[1] BACKFILL-slackbot-01 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot01-evidence.yml
