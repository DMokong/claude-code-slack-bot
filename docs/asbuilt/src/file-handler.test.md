---
type: Test
title: src/file-handler.test.ts
description: Skeleton concept for src/file-handler.test.ts (extracted; 1 symbols).
resource: src/file-handler.test.ts
tags:
  - src
  - module
  - test
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-06
explains:
  - src/file-handler.test.ts#slackFile
stale: false
stale_reason: ""
graph_hash: 9cd2e3defa5347c10e51dc358573f5528b52d3c8949ce203c6a1e4bca5bc6fec
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `slackFile` | function | 21-28 | no |

# Explanation
This is a small, tightly-scoped regression suite for exactly one FileHandler behavior — the interaction between channel file routing and post-message cleanup — added 2026-07-06 alongside the fix for claw-3t2q item 3. It exists to pin down, with real filesystem assertions rather than mocked fs calls, that a file delivered to a configured channel route survives the cleanup sweep that runs after every Slack message, while an un-routed scratch download does not.

# Decisions
- (BACKFILL-slackbot-06) Strategy worth preserving for future contributors extending this suite: node-fetch is mocked at the module level to remove network dependency and always return a fixed buffer, but fs itself is real — beforeEach creates a genuine temp directory via fs.mkdtempSync, and every assertion checks fs.existsSync against real files on disk rather than asserting mocked-call counts. This is a deliberate strength, not an oversight: it proves the file is ACTUALLY still on disk (or actually gone), which a mock-call-count assertion would not catch if the internal logic produced the 'right' call sequence but the wrong disk outcome. Three tests encode two invariants, each individually load-bearing: (1) 'routes files to targetDir without marking them as temp' and (2) 'channel-routed files survive cleanupTempFiles' together pin the invariant this suite exists for — targetDir deliveries must never carry ProcessedFile.tempPath and must still exist on disk after cleanupTempFiles runs; per the fix commit's own message, this is the test that failed against the pre-fix code. (3) 'un-routed downloads still land in the OS temp dir and are cleaned up' is the control case guarding the OPPOSITE regression: if a future change over-corrects (e.g. never setting tempPath at all), scratch downloads would leak into os.tmpdir() forever instead of being cleaned up, and this test — which asserts both that tempPath IS defined for un-routed files and that the file is gone after cleanup — would catch it immediately. What breaking it would mean in practice: a failure in test 1 or 2 means files a channel operator configured to be 'saved' via CHANNEL_FILE_ROUTES are being silently deleted again shortly after delivery — the exact user-visible data-loss symptom (claw-3t2q) that prompted this fix, so a regression here should be treated as a shipped bug, not a test nuisance. A failure in test 3 means the bot is leaking temp files into the OS temp directory on every un-routed upload — a slower-burning but real disk-usage problem. Coverage gap worth flagging for whoever extends this file: it exercises downloadAndProcessFiles -> downloadFile -> cleanupTempFiles only; formatFilePrompt, the mimetype-based isImageFile/isTextFile classification, and downloadFile's 50MB size-cutoff branch remain fully unverified by any test here.

# Citations
[1] BACKFILL-slackbot-06 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot06-evidence.yml
