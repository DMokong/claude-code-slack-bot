---
type: Module
title: src/types.ts
description: Skeleton concept for src/types.ts (extracted; 5 symbols).
resource: src/types.ts
tags:
  - src
  - module
  - interface
  - type
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-03
explains:
  - src/types.ts#ConversationSession
  - src/types.ts#EngineMode
  - src/types.ts#EngineSetBy
  - src/types.ts#ThreadStateEntry
  - src/types.ts#WorkingDirectoryConfig
stale: false
stale_reason: ""
graph_hash: 9759b135c07f30574b7bf7d243258420038465ac1a4c3772e3f14e18ef5df067
---

# Structure

## Exports
- `ConversationSession` (interface, lines 1-9)
- `EngineMode` (type, lines 19-19)
- `EngineSetBy` (type, lines 20-20)
- `ThreadStateEntry` (interface, lines 22-27)
- `WorkingDirectoryConfig` (interface, lines 11-17)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `ConversationSession` | interface | 1-9 | yes |
| `EngineMode` | type | 19-19 | yes |
| `EngineSetBy` | type | 20-20 | yes |
| `ThreadStateEntry` | interface | 22-27 | yes |
| `WorkingDirectoryConfig` | interface | 11-17 | yes |

# Explanation
This file is the shared vocabulary for session/thread/engine state
across the bot - a pure types module with no runtime logic, imported by
claude-handler.ts, engine-router.ts, thread-state-manager.ts, and
working-directory-manager.ts. Its value as a concept is less in any
individual type and more in what the types collectively reveal about
how the bot models "what is this thread doing right now, and why."

# Decisions
- (BACKFILL-slackbot-03) `ThreadStateEntry.copilot` is typed as the literal `null`, not
`string | null` like `claude` is - this is a type-level enforcement of
a design decision (Copilot sessions are ephemeral, never resumed) that
would otherwise live only in someone's memory or a code comment
elsewhere. If Copilot session resumption is ever added, this type has
to change first, which makes it a natural place to search when
evaluating "would this codebase support X." `EngineSetBy`'s four values
(`manual`, `auto-fallback`, `channel-default`, `global-default`) encode
a provenance/precedence model for engine selection that isn't visible
from `EngineMode` alone - a thread showing `engine: 'copilot'` could
mean a user explicitly typed a command, or it could mean Claude hit a
rate limit and auto-fell-back; anything that displays or logs engine
state to a human should probably surface `setBy` alongside `engine`,
not just `engine` by itself, or the distinction this type was clearly
designed to preserve gets lost downstream. `WorkingDirectoryConfig`'s
optional `threadTs`/`userId` fields on top of a required `channelId`
suggest a CSS-cascade-like specificity model (channel default, overridden
by thread, overridden by user) but this file only defines the shape -
the actual precedence resolution logic lives in
working-directory-manager.ts, outside this batch, and should be read
before assuming which field wins when more than one could apply.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
