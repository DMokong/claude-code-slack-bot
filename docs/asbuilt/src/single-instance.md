---
type: Module
title: src/single-instance.ts
description: Skeleton concept for src/single-instance.ts (extracted; 10 symbols).
resource: src/single-instance.ts
tags:
  - src
  - module
  - const
  - function
  - interface
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-02
explains:
  - src/single-instance.ts#ensureSingleInstance
  - src/single-instance.ts#findOtherInstances
  - src/single-instance.ts#getAncestry
  - src/single-instance.ts#getCwd
  - src/single-instance.ts#getLockPath
  - src/single-instance.ts#killInstance
  - src/single-instance.ts#remove
  - src/single-instance.ts#writeLockFile
stale: false
stale_reason: ""
graph_hash: 182c4a76ac41fbb6fe303225cec8eeb326b319e5416f34834c8fa4503042e983
---

# Structure

## Exports
- `EnsureOptions` (interface, lines 229-239)
- `RunningInstance` (interface, lines 54-58)
- `ensureSingleInstance` (function, lines 250-280)
- `findOtherInstances` (function, lines 118-158)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `EnsureOptions` | interface | 229-239 | yes |
| `RunningInstance` | interface | 54-58 | yes |
| `ensureSingleInstance` | function | 250-280 | yes |
| `findOtherInstances` | function | 118-158 | yes |
| `getAncestry` | function | 88-105 | no |
| `getCwd` | function | 61-73 | no |
| `getLockPath` | function | 13-17 | no |
| `killInstance` | function | 161-186 | no |
| `remove` | const | 197-205 | no |
| `writeLockFile` | function | 190-217 | no |

## Calls out
- `ensureSingleInstance` → `findOtherInstances` (same file)
- `ensureSingleInstance` → `getLockPath` (same file)
- `ensureSingleInstance` → [Logger.info](/src/logger.md)
- `ensureSingleInstance` → `killInstance` (same file)
- `ensureSingleInstance` → [Logger.warn](/src/logger.md)
- `ensureSingleInstance` → `writeLockFile` (same file)
- `findOtherInstances` → `getAncestry` (same file)
- `findOtherInstances` → `getCwd` (same file)
- `findOtherInstances` → [Logger.warn](/src/logger.md)
- `killInstance` → [kill](/scripts/run-via-webterm.md)
- `killInstance` → [Logger.warn](/src/logger.md)

## Called by
- `start` in [src/index.ts](/src/index.ts.md)
- `SlackHandler.updateMessageReaction` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
A startup-time guard against running two copies of this bot against the same Slack app token at once — two live instances would both receive and process the same Slack events (split-brain), corrupting shared state like `thread-state.json`. It combines a live process scan (authoritative) with a PID lock file (diagnostic only), and is invoked exactly once, at the top of `index.ts#start`, before anything else initializes.

# Decisions
- (BACKFILL-slackbot-02) (1) The lock file is explicitly NOT authoritative — the code comment on `writeLockFile` explains a subtle ordering constraint: `ensureSingleInstance()` runs before `index.ts` installs its own SIGTERM handler, so if this module registered its own signal handler to clean up the lock, it would fire FIRST on a `launchd kickstart -k` and force-exit the process before in-flight webterm turns could drain (claw-wb4a). So cleanup only happens on the `'exit'` event, and the actual single-instance enforcement is the `ps`+`lsof` scan (`findOtherInstances`), not the lock file. A future engineer "simplifying" this by adding SIGTERM handling here would silently reintroduce the dropped-reply bug. (2) `getAncestry`'s depth cap (3) is a carefully bounded compromise: too shallow and the process's own `tsx`/`npm`/shell parent chain gets flagged as another instance; too deep and, if this code ever runs inside a subprocess the bot itself spawned (e.g. a nested `claude` call), the actual supervising bot process would end up in the "self" ancestry set and get wrongly excluded from detection — which is precisely the case that must NOT be excluded. (3) `DEFAULT_PATTERN` deliberately does not match the bare `tsx/dist/loader.mjs` loader path (claw-a9zo, 2026-07-03 fix): it used to, and that flagged every tsx-loaded script sharing the bot's working directory — including a one-shot `scripts/run-via-webterm.ts` job spawned by an unrelated launchd digest job — refusing a legitimate bot restart mid-digest. The bot's own entry file appears directly in its process's command line and is matched explicitly instead.

# Citations
[1] BACKFILL-slackbot-02 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot02-evidence.yml
