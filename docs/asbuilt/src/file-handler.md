---
type: Module
title: src/file-handler.ts
description: Skeleton concept for src/file-handler.ts (extracted; 9 symbols).
resource: src/file-handler.ts
tags:
  - src
  - module
  - class
  - interface
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-03
  - BACKFILL-slackbot-06
explains:
  - src/file-handler.ts#FileHandler
  - src/file-handler.ts#FileHandler.cleanupTempFiles
  - src/file-handler.ts#FileHandler.downloadAndProcessFiles
  - src/file-handler.ts#FileHandler.downloadFile
  - src/file-handler.ts#FileHandler.formatFilePrompt
  - src/file-handler.ts#FileHandler.isImageFile
  - src/file-handler.ts#FileHandler.isTextFile
  - src/file-handler.ts#ProcessedFile
stale: false
stale_reason: ""
graph_hash: 9cd2e3defa5347c10e51dc358573f5528b52d3c8949ce203c6a1e4bca5bc6fec
---

# Structure

## Exports
- `FileHandler` (class, lines 18-179)
- `ProcessedFile` (interface, lines 8-16)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `FileHandler` | class | 18-179 | yes |
| `FileHandler.cleanupTempFiles` | method | 166-177 | yes |
| `FileHandler.downloadAndProcessFiles` | method | 25-47 | yes |
| `FileHandler.downloadFile` | method | 49-106 | yes |
| `FileHandler.formatFilePrompt` | method | 126-164 | yes |
| `FileHandler.isImageFile` | method | 108-110 | yes |
| `FileHandler.isTextFile` | method | 112-124 | yes |
| `ProcessedFile` | interface | 8-16 | yes |

## Calls out
- `FileHandler.downloadAndProcessFiles` → `FileHandler.downloadFile` (same file)
- `FileHandler.downloadFile` → `FileHandler.isImageFile` (same file)
- `FileHandler.downloadFile` → `FileHandler.isTextFile` (same file)

# Explanation
FileHandler is the sole ingestion path for Slack file attachments in this bot. It has three jobs: download the raw bytes from Slack's private URL, classify the file (image / text / binary) purely by mimetype prefix, and render it into prompt text a Claude or Copilot turn can consume — or clean it up afterward. It is invoked exclusively from SlackHandler.handleMessage, once per message carrying file attachments, and its lifecycle (download -> prompt formatting -> cleanup) brackets a single turn.

# Decisions
- (BACKFILL-slackbot-03) Load-bearing gotcha for anyone extending channel-scoped file routing:
- (BACKFILL-slackbot-06) The central thing a future reader needs is the tempPath/targetDir distinction, fixed 2026-07-06 (claw-3t2q item 3, commit 976d1924): ProcessedFile.tempPath is the ONLY signal cleanupTempFiles uses to decide whether to unlink a file after a turn ends. Before the fix, downloadFile set tempPath to the same value as path unconditionally, so a channel's configured file route (config.channelFileRoutes, populated from the CHANNEL_FILE_ROUTES env var — meant to be a PERMANENT save location) had its files deleted by the same cleanup sweep that scrubs scratch temp files, directly contradicting the module's own docstring ('saved there instead of temp dir'). The fix is one conditional spread: '...(targetDir ? {} : { tempPath: savedPath })'. The rule for anyone touching this file going forward: routed deliveries must NEVER carry tempPath; only files written to os.tmpdir() may. Separately, getSupportedFileTypes() — a static list of supported extensions — was removed 2026-07-06 (commit 74de1b75) as confirmed dead code: grep found zero callers anywhere in src/, consistent with a help/status command that was either never wired up or lost its caller earlier. If a 'what files can I upload?' feature is wanted again it needs to be rebuilt and wired, not un-deleted. The 50MB size cutoff (downloadFile) and the 10,000-character text-inline cutoff (formatFilePrompt) remain hardcoded magic numbers with no config knob, untouched by this remediation round — a 'why did my big file silently get dropped/truncated' investigation still starts here. Unrelated finding from the same audit window: src/permission-server-start.js still does 'require(./permission-mcp-server.ts)', but that file was deleted in the sibling 2026-07-06 permission-flow removal and nothing in package.json or src/index.ts invokes permission-server-start.js anymore — it is now a dangling, unreferenced launcher pointing at a file that no longer exists, worth deleting in a follow-up so a future grep for 'permission' doesn't lead someone down a dead end.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
[2] BACKFILL-slackbot-06 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot06-evidence.yml
