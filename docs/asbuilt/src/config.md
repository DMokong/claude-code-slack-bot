---
type: Module
title: src/config.ts
description: Skeleton concept for src/config.ts (extracted; 4 symbols).
resource: src/config.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-03
explains:
  - src/config.ts#loadChannelMap
  - src/config.ts#parseChannelFileRoutes
  - src/config.ts#resolveWebtermToken
  - src/config.ts#validateConfig
stale: false
stale_reason: ""
graph_hash: 182c4a76ac41fbb6fe303225cec8eeb326b319e5416f34834c8fa4503042e983
---

# Structure

## Exports
- `validateConfig` (function, lines 104-116)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `loadChannelMap` | function | 34-46 | no |
| `parseChannelFileRoutes` | function | 22-32 | no |
| `resolveWebtermToken` | function | 11-20 | no |
| `validateConfig` | function | 104-116 | yes |

## Calls out
- `loadChannelMap` → [Logger.warn](/src/logger.md)

## Called by
- `start` in [src/index.ts](/src/index.ts.md)

# Explanation
This module is the single place every other part of the bot reads
runtime configuration from - a plain object (`config`) assembled once at
import time from environment variables (via dotenv), not a class or a
lazily-evaluated accessor. Any new module that needs a setting should
import `config` from here rather than reading `process.env` directly;
that's what keeps parsing/defaulting logic (JSON blobs, boolean-ish
strings, comma-separated lists) in one place instead of scattered across
call sites.

# Decisions
- (BACKFILL-slackbot-03) Token resolution precedence in `resolveWebtermToken`: `WEBTERM_TOKEN`
env wins, then a shared token file (`WEBTERM_TOKEN_FILE` or
`~/.webterm/token`), then empty string - the empty-string fallback is
intentional (auth-off / pre-boot webterm), not an error case, so don't
"fix" it into a throw. `webterm.routeAll`/`webterm.channels` are a
migration lever off the legacy `claude -p` SDK path onto a
webterm-hosted interactive `claude` process (claw-op2n Phase 2) - but
the router in slack-handler.ts additionally requires zero file
attachments before honoring either setting, because the webterm handler
doesn't process files yet (claw-o05f). A channel can be 100%
"routeAll"-configured and still silently fall through to the old SDK
path any time a message carries a file; this is easy to miss when
debugging "why did this message not go through webterm." `directSpawnCmd`
is a parallel, separate opt-in (claw-3btg.1): its argv[0] must be an
absolute path on the webterm server's own spawn allowlist, a security
control that lives server-side and is invisible from this repo -
misconfiguring it fails on the webterm server, not here.
`channelFileRoutes`/`channelNames` both parse defensively and default to
`{}` on any error, by design, so a bad `CHANNEL_MAP_PATH` or malformed
`CHANNEL_FILE_ROUTES` JSON degrades to "no special routing" rather than
crashing bot startup - if you're debugging "channel routing isn't
working" the first thing to check is whether the JSON actually parsed
(silently swallowed), not whether the code path was reached. The
exported `config` object itself has no dedicated graph-extractable
symbol (it's a plain object literal, not a function/class) - if you're
building tooling that walks the call graph looking for "config", it
isn't there; only the four builder functions are addressable nodes.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
