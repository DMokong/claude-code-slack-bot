---
type: Module
title: src/image-uploader.test.ts
description: Skeleton concept for src/image-uploader.test.ts (extracted; 1 symbols).
resource: src/image-uploader.test.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-05
explains:
  - src/image-uploader.test.ts#createTempImages
stale: false
stale_reason: ""
graph_hash: 182c4a76ac41fbb6fe303225cec8eeb326b319e5416f34834c8fa4503042e983
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `createTempImages` | function | 197-207 | no |

# Explanation
This suite is the executable spec for ImageUploader (src/image-uploader.ts),
the component that turns image-gen/tool-output filesystem paths mentioned
in an assistant's reply into actual Slack file uploads. A future reader
modifying ImageUploader should treat this file as the contract: any
change to the extension allowlist, the extraction regex, the
cwd-resolution fallback order, or the upload cap must keep every test
here green or deliberately update the corresponding test.

# Decisions
- (BACKFILL-slackbot-05) (1) The suite uses real temporary files/directories (fs.mkdtempSync +
real PNG-header bytes) instead of mocking `fs`, because
resolveImagePath's behavior IS filesystem-existence checking — mocking
fs would test the mock, not the resolution order. (2) The batch-cap
test creates 15 real temp files and asserts exactly 10 uploadV2 calls,
pinning DEFAULT_MAX_UPLOADS=10 as a deliberate ceiling, not a bug —
Slack itself supports more attachments per message, but 10 bounds chat
noise and API load per turn. (3) The "resolves via cwd/local/" tests
encode an external contract: image-gen-mcp writes generated images to
`{cwd}/local/{YYYY}/{MM}/{file}` and its tool output references a path
like `/2026/03/img.png` missing the `/local/` prefix — resolveImagePath's
job is to reverse-engineer that convention. If image-gen-mcp ever
changes its storage layout, this suite's fixtures (localDir =
cwd/local/2026/03) must move with it, or these tests will pass against
a stale assumption while production silently fails to find real files.
(4) uploadImage's error-swallowing (catch, log, return false — never
throw) is deliberately tested via a rejected uploadV2 mock, because a
thrown upload error would otherwise crash the surrounding
message-handling flow for what is a best-effort, non-critical feature.

# Citations
[1] BACKFILL-slackbot-05 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot05-evidence.yml
