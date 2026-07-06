---
type: Module
title: src/image-uploader.ts
description: Skeleton concept for src/image-uploader.ts (extracted; 7 symbols).
resource: src/image-uploader.ts
tags:
  - src
  - module
  - class
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-03
explains:
  - src/image-uploader.ts#ImageUploader
  - src/image-uploader.ts#ImageUploader.constructor
  - src/image-uploader.ts#ImageUploader.extractImagePaths
  - src/image-uploader.ts#ImageUploader.isImagePath
  - src/image-uploader.ts#ImageUploader.resolveImagePath
  - src/image-uploader.ts#ImageUploader.uploadImage
  - src/image-uploader.ts#ImageUploader.uploadImages
stale: false
stale_reason: ""
graph_hash: 182c4a76ac41fbb6fe303225cec8eeb326b319e5416f34834c8fa4503042e983
---

# Structure

## Exports
- `ImageUploader` (class, lines 13-108)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `ImageUploader` | class | 13-108 | yes |
| `ImageUploader.constructor` | method | 17-19 | yes |
| `ImageUploader.extractImagePaths` | method | 26-35 | yes |
| `ImageUploader.isImagePath` | method | 21-24 | yes |
| `ImageUploader.resolveImagePath` | method | 41-55 | yes |
| `ImageUploader.uploadImage` | method | 57-81 | yes |
| `ImageUploader.uploadImages` | method | 83-107 | yes |

## Calls out
- `ImageUploader.extractImagePaths` → `ImageUploader.resolveImagePath` (same file)
- `ImageUploader.uploadImage` → [Logger.error](/src/logger.md)
- `ImageUploader.uploadImage` → [Logger.info](/src/logger.md)
- `ImageUploader.uploadImage` → [Logger.warn](/src/logger.md)
- `ImageUploader.uploadImages` → `ImageUploader.uploadImage` (same file)
- `ImageUploader.uploadImages` → [Logger.warn](/src/logger.md)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
ImageUploader is the live mechanism for getting images that Claude (or
an MCP tool it called, like image-gen-mcp) produced or referenced during
a query back into the originating Slack thread, so the human sees the
image inline rather than just a file path in text. It runs in two
triggers from slack-handler.ts: directly off Write/Edit tool_use inputs
whose `file_path` looks like an image, and post-hoc by regex-scanning
tool_result text for image-looking absolute paths.

# Decisions
- (BACKFILL-slackbot-03) `resolveImagePath`'s middle resolution tier -
`{cwd}/local/{path}` - is a hardcoded coupling to image-gen-mcp's
specific `file://`-URL storage convention (per its own inline comment).
This is a cross-repo assumption baked into this file with no
configuration knob: if image-gen-mcp (or any future MCP that writes
images) changes where it stores files, this resolution tier silently
stops matching and affected images fail closed (uploadImage logs a
warning and skips - no error surfaced to the Slack thread). Anyone
adding a new image-producing MCP server should check whether its
storage convention needs a fourth resolution tier here.
`DEFAULT_MAX_UPLOADS = 10` is a hardcoded cap with no config override
exposed to operators (only a code-level `maxUploads` parameter) - it
exists to stop a single verbose tool_result from spamming a Slack
thread with dozens of image uploads, not for cost/rate-limit reasons as
far as this file states. Both call sites in slack-handler.ts
(Write/Edit `file_path` interception vs. tool_result text scanning) are
independent of each other and could both fire for a legitimately
overlapping set of paths in a single turn - `uploadImages` dedupes its
own input list but has no cross-call memory, so the same image could be
uploaded twice across two separate `uploadImages` calls within one
response if both triggers see it. I did not find evidence either way of
this actually happening in practice; flagging it as a plausible
double-upload edge case for a future investigator, not a confirmed bug.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
