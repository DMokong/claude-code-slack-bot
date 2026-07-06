---
type: Module
title: src/image-handler.ts
description: Skeleton concept for src/image-handler.ts (extracted; 4 symbols).
resource: src/image-handler.ts
tags:
  - src
  - module
  - class
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-03
explains:
  - src/image-handler.ts#ImageHandler
  - src/image-handler.ts#ImageHandler.convertImageToBase64
  - src/image-handler.ts#ImageHandler.formatImagePrompt
  - src/image-handler.ts#ImageHandler.isImageSupported
stale: true
stale_reason: source removed
graph_hash: 182c4a76ac41fbb6fe303225cec8eeb326b319e5416f34834c8fa4503042e983
---

# Structure

## Exports
- `ImageHandler` (class, lines 4-39)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `ImageHandler` | class | 4-39 | yes |
| `ImageHandler.convertImageToBase64` | method | 7-16 | yes |
| `ImageHandler.formatImagePrompt` | method | 18-26 | yes |
| `ImageHandler.isImageSupported` | method | 28-38 | yes |

## Calls out
- `ImageHandler.convertImageToBase64` → [Logger.error](/src/logger.md)

# Explanation
ImageHandler is a small, self-contained utility for producing base64
data-URI representations of images and simple descriptive prompts for
them. As of this reading it has no callers anywhere in the codebase -
before extending it, confirm whether it is genuinely dead or whether
something outside `src/` (a script, a different entry point) still
depends on it, since a grep-based check like mine can miss dynamic
requires.

# Decisions
- (BACKFILL-slackbot-03) This class predates or parallels `ImageUploader`
(src/image-uploader.ts), which is the class that's actually wired into
slack-handler.ts today and does the real image-in-Slack-thread work by
uploading raw buffers via `files.uploadV2` - a completely different
mechanism from base64 data URIs. `ImageHandler.convertImageToBase64`
only makes sense if something needs to hand image bytes to the
Anthropic API as inline base64 content (the API's own expected format
for inline images) rather than as a file path for the SDK's Read tool
to open - that's a different use case from "upload this file to a Slack
thread." Before deleting this file as dead code, it's worth checking
whether an inbound-image-to-Claude flow (as opposed to the current
outbound-image-to-Slack flow that ImageUploader handles) was ever
planned or partially built around it - the shape of the class (base64
conversion + supported-mimetype allowlist + prompt formatting) looks
purpose-built for that, not accidental.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
