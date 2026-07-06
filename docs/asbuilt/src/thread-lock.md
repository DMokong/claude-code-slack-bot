---
type: Module
title: src/thread-lock.ts
description: Skeleton concept for src/thread-lock.ts (extracted; 1 symbols).
resource: src/thread-lock.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-02
explains:
  - src/thread-lock.ts#withThreadLock
stale: false
stale_reason: ""
graph_hash: eca695496946f7f044ecd15540643dc5d7d83983eb7612677d398da52a748505
---

# Structure

## Exports
- `withThreadLock` (function, lines 26-63)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `withThreadLock` | function | 26-63 | yes |

## Calls out
- `withThreadLock` → [Logger.debug](/src/logger.md)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
A minimal, dependency-free async mutex scoped per Slack thread, used to guarantee that messages posted to the same thread in quick succession are processed by the bot in the order Slack delivered them, while messages in different threads proceed fully in parallel. This matters because without it, two Slack messages arriving close together in the same thread could race through `ClaudeHandler` out of order, producing replies in the wrong sequence or corrupting per-thread state.

# Decisions
- (BACKFILL-slackbot-02) The core correctness property hinges on ONE specific ordering, called out explicitly in the source comment: the caller's own promise must be installed as the new map tail SYNCHRONOUSLY, before the first `await` in `withThreadLock`. If that installation happened after an await instead, a second call arriving in the gap between reading the map and installing the new tail could read the same stale "previous" value, and both calls would then believe they're waiting on the same predecessor — breaking the serialization guarantee entirely. This is a classic "TOCTOU on a non-atomic map update" hazard that promise chains are easy to get wrong on if refactored without noticing the comment. Map cleanup (deleting a thread's entry once nothing is queued behind it) is opportunistic, done in the `finally` block only when the finishing call is still the tail — this is what keeps `locks` from growing forever across the bot's lifetime without needing a separate sweep.

# Citations
[1] BACKFILL-slackbot-02 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot02-evidence.yml
