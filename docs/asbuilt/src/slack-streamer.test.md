---
type: Module
title: src/slack-streamer.test.ts
description: Skeleton concept for src/slack-streamer.test.ts (extracted; 2 symbols).
resource: src/slack-streamer.test.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-04
explains:
  - src/slack-streamer.test.ts#createMockClient
  - src/slack-streamer.test.ts#createMockStreamer
stale: false
stale_reason: ""
graph_hash: 9759b135c07f30574b7bf7d243258420038465ac1a4c3772e3f14e18ef5df067
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `createMockClient` | function | 12-16 | no |
| `createMockStreamer` | function | 5-10 | no |

# Explanation
Documents SlackStreamManager's fallback contract for a future reader touching Slack's chat-stream API integration: this class exists because Slack's `chatStream`/`ChatStreamer` streaming-message primitive is newer and less reliable than plain `chat.postMessage`, so every write goes through a wrapper that transparently falls back to accumulating plain text the moment streaming misbehaves, rather than propagating the error up to the caller.

# Decisions
- (BACKFILL-slackbot-04) Once `streamFailed` flips true it is NEVER reset by `reset()` — only a brand-new SlackStreamManager instance (a new message) clears it. This was a deliberate choice pinned by the "should not reset failed state" test: the rationale is that if Slack's streaming API misbehaved once for this message, retrying it mid-message risks a worse failure mode (a partially streamed message plus a fallback message) than just staying in accumulate-and-flush mode for the rest of that message. `recipient_user_id`/ `recipient_team_id` are conditionally omitted (not sent as undefined/null) because DM channels don't take those fields — the actual Slack API behavior when they're present-but-undefined was apparently unreliable enough to warrant a hard omission rather than trusting the API client's serialization to drop undefined keys.

# Citations
[1] BACKFILL-slackbot-04 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot04-evidence.yml
