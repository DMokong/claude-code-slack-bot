---
type: Module
title: src/slack-streamer.ts
description: Skeleton concept for src/slack-streamer.ts (extracted; 9 symbols).
resource: src/slack-streamer.ts
tags:
  - src
  - module
  - class
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-01
explains:
  - src/slack-streamer.ts#SlackStreamManager
  - src/slack-streamer.ts#SlackStreamManager.append
  - src/slack-streamer.ts#SlackStreamManager.consumeFallbackText
  - src/slack-streamer.ts#SlackStreamManager.reset
  - src/slack-streamer.ts#SlackStreamManager.stop
stale: false
stale_reason: ""
graph_hash: eca695496946f7f044ecd15540643dc5d7d83983eb7612677d398da52a748505
---

# Structure

## Exports
- `SlackStreamManager` (class, lines 4-94)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `SlackStreamManager` | class | 4-94 | yes |
| `SlackStreamManager.append` | method | 20-53 | yes |
| `SlackStreamManager.constructor` | method | 10-17 | yes |
| `SlackStreamManager.consumeFallbackText` | method | 84-88 | yes |
| `SlackStreamManager.failed` | method | 76-78 | yes |
| `SlackStreamManager.isStreaming` | method | 91-93 | yes |
| `SlackStreamManager.pendingFallbackText` | method | 80-82 | yes |
| `SlackStreamManager.reset` | method | 71-74 | yes |
| `SlackStreamManager.stop` | method | 56-68 | yes |

## Calls out
- `SlackStreamManager.append` → `SlackStreamManager.append` (same file)
- `SlackStreamManager.append` → [Logger.debug](/src/logger.md)
- `SlackStreamManager.append` → [Logger.warn](/src/logger.md)
- `SlackStreamManager.stop` → [Logger.debug](/src/logger.md)
- `SlackStreamManager.stop` → `SlackStreamManager.stop` (same file)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
This module exists because Slack's native streaming API (chatStream) is not guaranteed to always succeed mid-response, and a partially-streamed message with no fallback would just look broken to the user. SlackStreamManager is a small stateful wrapper used once per Claude response inside slack-handler.ts's handleMessage loop to make streaming best-effort with a correctness-preserving fallback.

# Decisions
- (BACKFILL-slackbot-01) Once a stream fails (any thrown error from chatStream() or activeStream.append()), the manager latches into fallback mode for the rest of that response — reset() is called between text segments (e.g. around a tool-use interruption) but is explicitly documented as NOT clearing streamFailed, only activeStream. The rejected alternative would be retrying native streaming on every new segment, but that risks a response where some segments streamed live and others didn't, producing inconsistent Slack UX (duplicate or out-of-order partial messages) — staying in fallback for the whole response instead means the worst case is "this one response posts as a single message at the end" rather than "this response is visually broken." recipient_user_id/recipient_team_id are included in chatStream's params conditionally, because — per the inline comment — Slack's API requires them for channel messages but rejects/doesn't need them for DMs; getting this wrong silently degrades to the streamFailed fallback path rather than crashing the handler, which means a regression here could look like "streaming just doesn't work in channels" without an obvious stack trace, since errors are only logged at warn level and swallowed into fallbackText accumulation.

# Citations
[1] BACKFILL-slackbot-01 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot01-evidence.yml
