---
type: Module
title: src/session-id.ts
description: Skeleton concept for src/session-id.ts (extracted; 1 symbols).
resource: src/session-id.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-02
explains:
  - src/session-id.ts#threadToSessionId
stale: false
stale_reason: ""
graph_hash: d0d5217b5cdd1a8ac5b3c19460b09c3aa7a549e25c30c4a62a40ab119cb591eb
---

# Structure

## Exports
- `threadToSessionId` (function, lines 14-16)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `threadToSessionId` | function | 14-16 | yes |

## Called by
- `ClaudeHandler.createSession` in [src/claude-handler.ts](/src/claude-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
A single deterministic mapping from a Slack `thread_ts` to a stable session UUID, used only by the `claude -p` SDK path (`claude-handler.ts`, `slack-handler.ts`) to resume per-thread conversations via Claude Code's `--session-id` flag. A future reader should not assume this is THE session-identity mechanism for the whole bot — the webterm runtime path uses an entirely separate scheme (webterm session titles), and the two are not unified or cross-referenced anywhere.

# Decisions
- (BACKFILL-slackbot-02) UUID v5 (not v4) is used specifically because it's deterministic: hashing the same `thread_ts` against the same fixed namespace (`CLAUDECLAW_NAMESPACE`) always yields the same UUID, across process restarts, without persisting a lookup table anywhere. This means the mapping is effectively a pure function of `thread_ts` — there's no way to "forget" or manually remap a thread's session id short of changing the namespace constant, which would invalidate every existing session id at once (a hidden global blast radius worth knowing before ever touching `CLAUDECLAW_NAMESPACE`).

# Citations
[1] BACKFILL-slackbot-02 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot02-evidence.yml
