---
type: Module
title: src/engine-router.test.ts
description: Skeleton concept for src/engine-router.test.ts (extracted; 1 symbols).
resource: src/engine-router.test.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-04
explains:
  - src/engine-router.test.ts#writeChannelConfig
stale: false
stale_reason: ""
graph_hash: 9759b135c07f30574b7bf7d243258420038465ac1a4c3772e3f14e18ef5df067
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `writeChannelConfig` | function | 19-24 | no |

# Explanation
Documents the precedence order a future reader needs before touching either engine-router.ts or thread-state-manager.ts: thread state beats channel default beats the hard-coded global default of `'claude'`. This exists because the bot supports two backends (Claude Code's REPL and the GitHub Copilot CLI) and a Slack channel or an individual thread can pin one over the other — e.g. an experimental channel defaulting to Copilot while a specific thread within it stays on Claude because a user typed a manual override command.

# Decisions
- (BACKFILL-slackbot-04) The malformed-JSON-in-channel-engine.json test is a deliberate resilience decision, not an oversight: `getChannelDefault` catches the JSON.parse failure and logs a warning rather than propagating, so a hand-edited or partially-written config file degrades to "no channel default" instead of breaking engine routing for every channel. A future reader adding new engine values should note `getChannelDefault`'s `value === 'copilot' || value === 'claude'` check is a closed allowlist — an unrecognized value in the config file is silently treated as absent, the same fail-safe-to-global-default posture as a missing file.

# Citations
[1] BACKFILL-slackbot-04 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot04-evidence.yml
