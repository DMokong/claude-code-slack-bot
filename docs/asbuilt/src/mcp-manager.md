---
type: Module
title: src/mcp-manager.ts
description: Skeleton concept for src/mcp-manager.ts (extracted; 13 symbols).
resource: src/mcp-manager.ts
tags:
  - src
  - module
  - class
  - interface
  - method
  - type
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-03
explains:
  - src/mcp-manager.ts#McpConfiguration
  - src/mcp-manager.ts#McpHttpServerConfig
  - src/mcp-manager.ts#McpManager.constructor
  - src/mcp-manager.ts#McpManager.formatMcpInfo
  - src/mcp-manager.ts#McpManager.getDefaultAllowedTools
  - src/mcp-manager.ts#McpManager.getServerConfiguration
  - src/mcp-manager.ts#McpManager.loadConfiguration
  - src/mcp-manager.ts#McpManager.reloadConfiguration
  - src/mcp-manager.ts#McpManager.validateServerConfig
  - src/mcp-manager.ts#McpSSEServerConfig
  - src/mcp-manager.ts#McpServerConfig
  - src/mcp-manager.ts#McpStdioServerConfig
stale: false
stale_reason: ""
graph_hash: 8a0d575a40873cd07242dedf282b03d07a103f46e0d9f41720eeb5c6f031704a
---

# Structure

## Exports
- `McpConfiguration` (interface, lines 26-28)
- `McpHttpServerConfig` (type, lines 18-22)
- `McpManager` (class, lines 30-159)
- `McpSSEServerConfig` (type, lines 12-16)
- `McpServerConfig` (type, lines 24-24)
- `McpStdioServerConfig` (type, lines 5-10)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `McpConfiguration` | interface | 26-28 | yes |
| `McpHttpServerConfig` | type | 18-22 | yes |
| `McpManager` | class | 30-159 | yes |
| `McpManager.constructor` | method | 35-37 | yes |
| `McpManager.formatMcpInfo` | method | 124-153 | yes |
| `McpManager.getDefaultAllowedTools` | method | 114-122 | yes |
| `McpManager.getServerConfiguration` | method | 109-112 | yes |
| `McpManager.loadConfiguration` | method | 39-79 | yes |
| `McpManager.reloadConfiguration` | method | 155-158 | yes |
| `McpManager.validateServerConfig` | method | 81-107 | yes |
| `McpSSEServerConfig` | type | 12-16 | yes |
| `McpServerConfig` | type | 24-24 | yes |
| `McpStdioServerConfig` | type | 5-10 | yes |

## Calls out
- `McpManager.formatMcpInfo` → `McpManager.loadConfiguration` (same file)
- `McpManager.getDefaultAllowedTools` → `McpManager.loadConfiguration` (same file)
- `McpManager.getServerConfiguration` → `McpManager.loadConfiguration` (same file)
- `McpManager.loadConfiguration` → [Logger.error](/src/logger.md)
- `McpManager.loadConfiguration` → [Logger.info](/src/logger.md)
- `McpManager.loadConfiguration` → `McpManager.validateServerConfig` (same file)
- `McpManager.loadConfiguration` → [Logger.warn](/src/logger.md)
- `McpManager.reloadConfiguration` → `McpManager.loadConfiguration` (same file)
- `McpManager.validateServerConfig` → [Logger.warn](/src/logger.md)

## Called by
- `ClaudeHandler.streamQuery` in [src/claude-handler.ts](/src/claude-handler.md)
- `ClaudeHandler.streamQuery` in [src/claude-handler.ts](/src/claude-handler.md)
- `start` in [src/index.ts](/src/index.ts.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
McpManager owns a JSON config file (default `./mcp-servers.json`,
resolved against the process's CWD at construction) that lists which
external MCP servers this Slack bot should expose to the Claude Code
SDK on each query. It is a bot-level indirection layer - the SDK itself
doesn't read this file; McpManager reads it and hands the resulting
server map + a coarse allowed-tools list into `ClaudeHandler`'s query
options.

# Decisions
- (BACKFILL-slackbot-03) `configPath` defaults to a *relative* path (`./mcp-servers.json`)
resolved via `path.resolve` at construction time against whatever the
process's CWD happens to be at that moment - not against the repo root
or `__dirname`. If the bot is ever launched with a different working
directory (a different launchd plist, a different `cwd` in a supervisor
config), this silently resolves to the wrong file and
`loadConfiguration` treats "file not found" as "zero MCP servers
configured" rather than an error - there is no loud failure mode here,
just a quieter bot with fewer tools than expected. Malformed individual
server entries are deleted from the in-memory config rather than
failing the whole load (`validateServerConfig`) - a typo in one server's
JSON only costs you that one server, not all of them, which is a
deliberate resilience choice worth preserving if this file is
refactored. `getDefaultAllowedTools()` grants at the
`mcp__{serverName}` wildcard level, not per-tool - "all MCP tools are
allowed by default" (per `formatMcpInfo`'s own footer text) is a stated
security posture, not an oversight; a future per-tool allowlist feature
would need to change this method's return shape and probably the
config file's schema too. `reloadConfiguration()` is purely
memo-invalidation - there is no filesystem watcher, so config changes on
disk have zero effect until a human runs the bot's MCP-reload command.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
