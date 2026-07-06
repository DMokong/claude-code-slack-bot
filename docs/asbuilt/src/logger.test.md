---
type: Module
title: src/logger.test.ts
description: Skeleton concept for src/logger.test.ts (extracted; 1 symbols).
resource: src/logger.test.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-05
explains:
  - src/logger.test.ts#todayFilename
stale: false
stale_reason: ""
graph_hash: 8a0d575a40873cd07242dedf282b03d07a103f46e0d9f41720eeb5c6f031704a
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `todayFilename` | function | 29-34 | no |

# Explanation
This suite pins the behavior of Logger (src/logger.ts), the shared
logging shim used across the bot for both console and durable file
output. A future reader should understand this file exists
specifically to prevent regression of a real production bug: a
long-lived bot process used to write all its logs into a file named
for the date the PROCESS started, not the current date, making a stale
zombie instance's logs indistinguishable from a live one until someone
diffed timestamps by hand.

# Decisions
- (BACKFILL-slackbot-05) (1) Every test calls vi.resetModules() and dynamically re-imports
'./logger' — Logger.ts has module-level mutable state (lastEnsuredDir,
fileLoggingDisabled) set once and cached, so reusing the same imported
module instance across tests with different SLACK_BOT_LOG_DIR values
would leak state between tests and produce flaky, order-dependent
failures; this is the standard idiom for testing modules with
top-level mutable state under vitest. (2) The midnight-rollover test
uses vi.useFakeTimers()/vi.setSystemTime() to literally cross a real
day boundary (23:59:30 -> 00:00:30) rather than mocking Date, because
the rotation logic calls `new Date()` directly at write time — faking
the system clock is the only way to exercise rollover without adding
an injectable-clock seam to production code. (3) SLACK_BOT_LOG_DIR=off
is a real operational escape hatch, not a test-only flag — it exists
so that when a downstream supervisor (launchd, or a start-script's
nohup redirect) is already producing a dated log file, the app doesn't
double-write; a future deployment mode that adds its own log capture
should check whether it needs this same off-switch. (4) console output
and file output are independent and additive by design (verified by a
dedicated test) — removing the console.log call to "clean up" output
would silently break live `tail`-based debugging during interactive
dev, which has no reason to also point SLACK_BOT_LOG_DIR at a file.

# Citations
[1] BACKFILL-slackbot-05 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot05-evidence.yml
