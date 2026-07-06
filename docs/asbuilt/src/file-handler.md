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
explains:
  - src/file-handler.ts#FileHandler.cleanupTempFiles
  - src/file-handler.ts#FileHandler.downloadAndProcessFiles
  - src/file-handler.ts#FileHandler.downloadFile
  - src/file-handler.ts#FileHandler.formatFilePrompt
  - src/file-handler.ts#FileHandler.getSupportedFileTypes
  - src/file-handler.ts#FileHandler.isImageFile
  - src/file-handler.ts#FileHandler.isTextFile
  - src/file-handler.ts#ProcessedFile
stale: true
stale_reason: "changed: src/file-handler.ts#FileHandler.downloadFile,
  src/file-handler.ts#FileHandler.getSupportedFileTypes"
graph_hash: 182c4a76ac41fbb6fe303225cec8eeb326b319e5416f34834c8fa4503042e983
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
- `FileHandler.cleanupTempFiles` → [Logger.debug](/src/logger.md)
- `FileHandler.cleanupTempFiles` → [Logger.warn](/src/logger.md)
- `FileHandler.downloadAndProcessFiles` → `FileHandler.downloadFile` (same file)
- `FileHandler.downloadAndProcessFiles` → [Logger.error](/src/logger.md)
- `FileHandler.downloadAndProcessFiles` → [Logger.info](/src/logger.md)
- `FileHandler.downloadFile` → [Logger.debug](/src/logger.md)
- `FileHandler.downloadFile` → [Logger.error](/src/logger.md)
- `FileHandler.downloadFile` → [Logger.info](/src/logger.md)
- `FileHandler.downloadFile` → `FileHandler.isImageFile` (same file)
- `FileHandler.downloadFile` → `FileHandler.isTextFile` (same file)
- `FileHandler.downloadFile` → [Logger.warn](/src/logger.md)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
FileHandler is the ingestion path for Slack file uploads: it downloads
the raw attachment, classifies it (image/text/binary), and renders it
into prompt text the SDK query can consume. It is deliberately dumb
about content understanding - classification is mimetype-prefix
matching, not content sniffing, and "reading" a file just means
inlining its raw text (truncated) into the prompt string.

# Decisions
- (BACKFILL-slackbot-03) Load-bearing gotcha for anyone extending channel-scoped file routing:
`downloadFile` always sets the returned `ProcessedFile.tempPath` equal
to `.path`, regardless of whether the file was written to `os.tmpdir()`
or to a configured `targetDir` (channel file route). `cleanupTempFiles`
then unconditionally `unlinkSync`s whatever `tempPath` it's given, and
slack-handler.ts calls `cleanupTempFiles(processedFiles)` after every
message unconditionally - including when a channel file route was
active. Net effect: files that this module's own docstring says are
"saved there instead of temp dir" (implying persistence) are deleted
immediately after the response completes, exactly like real temp files.
If channel-routed files are meant to survive past the triggering
message, `ProcessedFile` needs a way to distinguish "this was a
permanent route" from "this was a scratch temp file" (e.g. only
populate `tempPath` when no `targetDir` was given), and
`cleanupTempFiles` needs to respect that distinction. This is not
currently guarded by a test as far as I could tell from this file alone.
Separately: the 50MB size cutoff and the 10,000-character text-inline
cutoff are both hardcoded magic numbers with no config knob - a future
"why did my big file get silently dropped/truncated" investigation
should start here. `getSupportedFileTypes()` is dead code (no callers
anywhere in `src/`) - it looks like it was meant to back a help/status
command that was never wired up, or was wired up and then removed.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
