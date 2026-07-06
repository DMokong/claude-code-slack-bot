---
type: Module
title: src/single-instance.test.ts
description: Skeleton concept for src/single-instance.test.ts (extracted; 5 symbols).
resource: src/single-instance.test.ts
tags:
  - src
  - module
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-05
explains:
  - src/single-instance.test.ts#isAlive
  - src/single-instance.test.ts#spawnFakeBot
  - src/single-instance.test.ts#waitForExit
  - src/single-instance.test.ts#waitForFile
  - src/single-instance.test.ts#waitForStdout
stale: false
stale_reason: ""
graph_hash: d0d5217b5cdd1a8ac5b3c19460b09c3aa7a549e25c30c4a62a40ab119cb591eb
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `isAlive` | function | 90-97 | no |
| `spawnFakeBot` | function | 68-88 | no |
| `waitForExit` | function | 100-111 | no |
| `waitForFile` | function | 222-229 | no |
| `waitForStdout` | function | 209-219 | no |

## Calls out
- `isAlive` → [kill](/scripts/run-via-webterm.md)

# Explanation
This suite is the safety net for src/single-instance.ts, which
prevents two live copies of the Slack bot from running against the
same Slack app config simultaneously (which would double-handle every
event and corrupt the shared thread-state.json). A future reader
should treat the "graceful shutdown coexistence" describe block as the
single most important test in this file — it isn't testing
single-instance detection at all, it's testing that the single-instance
guard's own process lifecycle hooks don't interfere with a completely
separate subsystem (graceful shutdown on SIGTERM).

# Decisions
- (BACKFILL-slackbot-05) Two hard-won, non-obvious design decisions this suite protects:
(1) claw-a9zo — DEFAULT_PATTERN deliberately does NOT match on the bare
`tsx/dist/loader.mjs` loader substring, even though that would be the
simplest way to catch every tsx-loaded invocation. That substring
appears in the argv of EVERY tsx-loaded script run from the bot's
working directory, including the one-shot scripts/run-via-webterm.ts
job runner spawned by the ai-digest launchd job. An earlier, looser
pattern flagged that legitimate job run as "another bot instance" and
refused to let the real bot restart while the job was mid-flight. The
fix matches only the app's own entry file (dist/index.js or
src/index.ts), which is present in every real bot invocation and
absent from job-runner invocations, so gating on the shared loader path
added false positives without adding any real detection power.
(2) claw-wb4a — ensureSingleInstance() deliberately registers its
lock-file cleanup via `process.on('exit', ...)`, never via a
SIGTERM/SIGINT listener, even though that would be the more obvious way
to clean up on a kill signal. ensureSingleInstance() runs at startup
BEFORE index.ts installs its own gracefulShutdown SIGTERM handler; Node
fires same-signal listeners in registration order, so a SIGTERM
listener registered here would fire FIRST and call process.exit(0)
immediately — killing the process before gracefulShutdown's async
drain (letting in-flight webterm turns finish and reply to Slack) ever
runs. Because Slack has already ack'd the event by the time this
happens, the reply is silently and permanently lost with no
redelivery to recover it. The test replicates the exact production
startup order in a real child process and asserts the OBSERVABLE
OUTCOME (a marker file written by the async drain) rather than
asserting anything about internal code structure, which would be more
brittle to refactors that preserve behavior.

# Citations
[1] BACKFILL-slackbot-05 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot05-evidence.yml
