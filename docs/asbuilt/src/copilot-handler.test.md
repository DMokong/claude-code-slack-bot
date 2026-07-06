---
type: Module
title: src/copilot-handler.test.ts
description: Skeleton concept for src/copilot-handler.test.ts (extracted; 1 symbols).
resource: src/copilot-handler.test.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-04
explains:
  - src/copilot-handler.test.ts#makeMockProcess
stale: false
stale_reason: ""
graph_hash: 182c4a76ac41fbb6fe303225cec8eeb326b319e5416f34834c8fa4503042e983
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `makeMockProcess` | function | 12-31 | no |

# Explanation
Regression-lock for CopilotHandler's parsing of the GitHub Copilot CLI's actual `--output-format json` JSONL wire format. The comment block at the top of the first test (lines 42-50 of the .ts file) is itself the documentation of that observed shape — session.* setup events, user.message, assistant.turn_start, ephemeral assistant.reasoning_delta/ message_delta streaming chunks, the authoritative assistant.message event (full text in `data.content`), assistant.turn_end, and a trailing result event with exit code and usage — because that shape isn't documented anywhere else in this repo and was reverse-engineered by watching real CLI output. A future reader touching `extractTextFromLines` should treat this comment (and the fixture JSONL literal it backs) as the spec.

# Decisions
- (BACKFILL-slackbot-04) makeMockProcess's abort test intentionally never emits a `close` event — that's the only way to prove the abort path resolves the promise via the AbortSignal listener alone, independent of the process's own lifecycle events; if a future refactor made abort wait on `close` too, this test would hang instead of quietly passing for the wrong reason. The suite also never asserts anything about `assistant.message_delta` or `assistant.reasoning_delta` events beyond implicitly ignoring them — those are streaming deltas superseded by the final `assistant.message`, and `extractTextFromLines` only reads `assistant.message`, so any future attempt to stream partial text to Slack via the deltas would need new tests, not a tweak to this file. `COPILOT_EXECUTABLE` exists because the default path (`/Users/dustincheng/.local/bin/copilot`) is a developer-machine-specific absolute path, not something portable across hosts.

# Citations
[1] BACKFILL-slackbot-04 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot04-evidence.yml
