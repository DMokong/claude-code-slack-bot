---
type: Module
title: src/working-directory-manager.ts
description: Skeleton concept for src/working-directory-manager.ts (extracted; 13 symbols).
resource: src/working-directory-manager.ts
tags:
  - src
  - module
  - class
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-02
explains:
  - src/working-directory-manager.ts#WorkingDirectoryManager.formatChannelSetupMessage
  - src/working-directory-manager.ts#WorkingDirectoryManager.formatDirectoryMessage
  - src/working-directory-manager.ts#WorkingDirectoryManager.getConfigKey
  - src/working-directory-manager.ts#WorkingDirectoryManager.getWorkingDirectory
  - src/working-directory-manager.ts#WorkingDirectoryManager.isGetCommand
  - src/working-directory-manager.ts#WorkingDirectoryManager.parseSetCommand
  - src/working-directory-manager.ts#WorkingDirectoryManager.removeWorkingDirectory
  - src/working-directory-manager.ts#WorkingDirectoryManager.resolveDirectory
  - src/working-directory-manager.ts#WorkingDirectoryManager.setWorkingDirectory
stale: false
stale_reason: ""
graph_hash: d0d5217b5cdd1a8ac5b3c19460b09c3aa7a549e25c30c4a62a40ab119cb591eb
---

# Structure

## Exports
- `WorkingDirectoryManager` (class, lines 7-220)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `WorkingDirectoryManager` | class | 7-220 | yes |
| `WorkingDirectoryManager.formatChannelSetupMessage` | method | 199-219 | yes |
| `WorkingDirectoryManager.formatDirectoryMessage` | method | 168-187 | yes |
| `WorkingDirectoryManager.getChannelWorkingDirectory` | method | 189-193 | yes |
| `WorkingDirectoryManager.getConfigKey` | method | 11-19 | yes |
| `WorkingDirectoryManager.getWorkingDirectory` | method | 99-135 | yes |
| `WorkingDirectoryManager.hasChannelWorkingDirectory` | method | 195-197 | yes |
| `WorkingDirectoryManager.isGetCommand` | method | 164-166 | yes |
| `WorkingDirectoryManager.listConfigurations` | method | 146-148 | yes |
| `WorkingDirectoryManager.parseSetCommand` | method | 150-162 | yes |
| `WorkingDirectoryManager.removeWorkingDirectory` | method | 137-144 | yes |
| `WorkingDirectoryManager.resolveDirectory` | method | 64-97 | yes |
| `WorkingDirectoryManager.setWorkingDirectory` | method | 21-62 | yes |

## Calls out
- `WorkingDirectoryManager.getChannelWorkingDirectory` → `WorkingDirectoryManager.getConfigKey` (same file)
- `WorkingDirectoryManager.getWorkingDirectory` → [Logger.debug](/src/logger.md)
- `WorkingDirectoryManager.getWorkingDirectory` → `WorkingDirectoryManager.getConfigKey` (same file)
- `WorkingDirectoryManager.getWorkingDirectory` → `WorkingDirectoryManager.resolveDirectory` (same file)
- `WorkingDirectoryManager.hasChannelWorkingDirectory` → `WorkingDirectoryManager.getChannelWorkingDirectory` (same file)
- `WorkingDirectoryManager.removeWorkingDirectory` → `WorkingDirectoryManager.getConfigKey` (same file)
- `WorkingDirectoryManager.removeWorkingDirectory` → [Logger.info](/src/logger.md)
- `WorkingDirectoryManager.resolveDirectory` → [Logger.debug](/src/logger.md)
- `WorkingDirectoryManager.setWorkingDirectory` → [Logger.error](/src/logger.md)
- `WorkingDirectoryManager.setWorkingDirectory` → `WorkingDirectoryManager.getConfigKey` (same file)
- `WorkingDirectoryManager.setWorkingDirectory` → [Logger.info](/src/logger.md)
- `WorkingDirectoryManager.setWorkingDirectory` → `WorkingDirectoryManager.resolveDirectory` (same file)
- `WorkingDirectoryManager.setWorkingDirectory` → [Logger.warn](/src/logger.md)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
In-memory per-Slack-context configuration of which filesystem directory claude should treat as its working directory, exposed to users via chat commands (`cwd <path>`, `set directory <path>`, bare `cwd`/`cwd?` to read it back). This is what lets different Slack channels or threads point claude at different local projects without any deploy-time configuration change.

# Decisions
- (BACKFILL-slackbot-02) (1) There is no persistence layer at all — `configs` is a plain in-memory `Map`, so every `cwd` setting a user has configured is lost on every bot restart (including the routine restarts covered by `single-instance.ts`'s adoption story for webterm sessions — the conversation may survive a restart via webterm session adoption, but its working-directory setting does not, unless re-derived from `config.defaultWorkingDirectory`). A future engineer wiring up persistence should be aware this is a clean break, not an incremental extension. (2) Precedence (thread > channel/DM > global default) is encoded directly into the shape of the map KEY rather than as an explicit priority field checked at lookup time — `getConfigKey` is the single source of truth for how a Slack context maps to a configuration slot, and `getWorkingDirectory` simply tries the more specific key before the less specific one. (3) There is no path sandboxing: `resolveDirectory` will resolve and accept any absolute path that exists and is a directory, readable to the bot process — the trust boundary here is "whatever this OS user can read," not "whatever the Slack workspace is scoped to." Anyone adding new callers of `getWorkingDirectory` that feed the result somewhere more sensitive than a `cwd` argument to the claude CLI should re-examine this assumption.

# Citations
[1] BACKFILL-slackbot-02 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot02-evidence.yml
