---
type: Module
title: src/permission-mcp-server.ts
description: Skeleton concept for src/permission-mcp-server.ts (extracted; 9 symbols).
resource: src/permission-mcp-server.ts
tags:
  - src
  - module
  - class
  - interface
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-03
explains:
  - src/permission-mcp-server.ts#PermissionMCPServer
  - src/permission-mcp-server.ts#PermissionMCPServer.constructor
  - src/permission-mcp-server.ts#PermissionMCPServer.handlePermissionPrompt
  - src/permission-mcp-server.ts#PermissionMCPServer.resolveApproval
  - src/permission-mcp-server.ts#PermissionMCPServer.run
  - src/permission-mcp-server.ts#PermissionMCPServer.setupHandlers
  - src/permission-mcp-server.ts#PermissionMCPServer.waitForApproval
  - src/permission-mcp-server.ts#PermissionRequest
  - src/permission-mcp-server.ts#PermissionResponse
stale: false
stale_reason: ""
graph_hash: 9759b135c07f30574b7bf7d243258420038465ac1a4c3772e3f14e18ef5df067
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `PermissionMCPServer` | class | 28-258 | no |
| `PermissionMCPServer.constructor` | method | 36-51 | no |
| `PermissionMCPServer.handlePermissionPrompt` | method | 99-220 | no |
| `PermissionMCPServer.resolveApproval` | method | 241-251 | no |
| `PermissionMCPServer.run` | method | 253-257 | no |
| `PermissionMCPServer.setupHandlers` | method | 53-97 | no |
| `PermissionMCPServer.waitForApproval` | method | 222-238 | no |
| `PermissionRequest` | interface | 14-20 | no |
| `PermissionResponse` | interface | 22-26 | no |

## Calls out
- `PermissionMCPServer.constructor` → `PermissionMCPServer.setupHandlers` (same file)
- `PermissionMCPServer.handlePermissionPrompt` → [Logger.error](/src/logger.md)
- `PermissionMCPServer.handlePermissionPrompt` → `PermissionMCPServer.waitForApproval` (same file)
- `PermissionMCPServer.run` → [Logger.info](/src/logger.md)
- `PermissionMCPServer.setupHandlers` → `PermissionMCPServer.handlePermissionPrompt` (same file)

## Called by
- `SlackHandler.setupEventHandlers` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
PermissionMCPServer implements a human-in-the-loop tool-approval flow:
an MCP server exposing one tool (`permission_prompt`) that, if the
Claude Code SDK is configured to call it before running a tool, posts an
Approve/Deny message to Slack and blocks until someone clicks a button
or five minutes pass. Understanding this file requires understanding
that it is two halves - an initiating half (`handlePermissionPrompt`,
only reachable if something calls the `permission_prompt` MCP tool) and
a receiving half (`resolveApproval`, called from Slack button-click
handlers) - and, as of this reading, only the receiving half is wired
into anything live.

# Decisions
- (BACKFILL-slackbot-03) This is the most important gotcha in this batch: `ClaudeHandler.streamQuery`
(src/claude-handler.ts) sets `permissionMode: 'bypassPermissions'`
unconditionally on every query, and nowhere in claude-handler.ts is a
`permissionPromptToolName` (or equivalent) option set that would route
the SDK's permission decisions to this server's `permission_prompt`
tool. I checked this by reading claude-handler.ts directly, not by
trusting a call-graph edge - edges here would plausibly show
`slack-handler.ts` importing `permissionServer` and conclude the whole
flow is "connected," but the connection that matters (the SDK actually
invoking the tool) doesn't exist in the current wiring. Practically:
Approve/Deny buttons will never appear in Slack today, because nothing
calls `handlePermissionPrompt` to post them - `bypassPermissions` means
every tool call is auto-allowed with no human gate. If a future change
re-enables per-tool approval, the receiving half (`resolveApproval`,
the Slack button click handlers in `SlackHandler.setupEventHandlers`,
the 5-minute fail-closed timeout) is already correct and tested-looking
and shouldn't need to change - only the SDK options in
claude-handler.ts (and probably an mcp-servers.json entry registering
this server, which also doesn't currently exist) need to be added back.
The `pendingApprovals` Map is pure in-memory state with no persistence:
a pending approval is lost across a process restart, and the requester
side (`waitForApproval`'s Promise) would simply hang until the 5-minute
timeout rather than fail fast. The file's dual entry-point design
(importable singleton module vs. standalone process via
`permission-server-start.js` + the `require.main === module` guard) is
unused in either mode as far as package.json and the mcp-servers config
files show - worth confirming with the person who last touched this
before assuming it's safe to delete, since dormant-but-intentional
scaffolding for a near-term feature looks identical to abandoned code
from a cold read.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
