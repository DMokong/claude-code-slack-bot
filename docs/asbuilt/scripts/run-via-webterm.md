---
type: Module
title: scripts/run-via-webterm.ts
description: Skeleton concept for scripts/run-via-webterm.ts (extracted; 18 symbols).
resource: scripts/run-via-webterm.ts
tags:
  - scripts
  - module
  - const
  - function
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-05
explains:
  - scripts/run-via-webterm.ts#adoptSession
  - scripts/run-via-webterm.ts#api
  - scripts/run-via-webterm.ts#captureResponse
  - scripts/run-via-webterm.ts#createAndBoot
  - scripts/run-via-webterm.ts#gridText
  - scripts/run-via-webterm.ts#hasResponse
  - scripts/run-via-webterm.ts#hasSpinner
  - scripts/run-via-webterm.ts#kill
  - scripts/run-via-webterm.ts#main
  - scripts/run-via-webterm.ts#normalize
  - scripts/run-via-webterm.ts#postJson
  - scripts/run-via-webterm.ts#runTurn
stale: false
stale_reason: ""
graph_hash: d0d5217b5cdd1a8ac5b3c19460b09c3aa7a549e25c30c4a62a40ab119cb591eb
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `adoptSession` | function | 140-152 | no |
| `api` | function | 60-62 | no |
| `arg` | function | 33-36 | no |
| `captureResponse` | function | 122-137 | no |
| `createAndBoot` | function | 154-182 | no |
| `enter` | function | 83-83 | no |
| `gridText` | function | 68-80 | no |
| `hasResponse` | function | 115-117 | no |
| `hasSpinner` | function | 99-101 | no |
| `kill` | function | 84-84 | no |
| `log` | const | 58-58 | no |
| `main` | function | 215-230 | no |
| `normalize` | function | 106-114 | no |
| `paste` | function | 81-81 | no |
| `postJson` | function | 63-67 | no |
| `runTurn` | function | 185-213 | no |
| `send` | function | 82-82 | no |
| `sleep` | const | 57-57 | no |

## Calls out
- `adoptSession` → `api` (same file)
- `adoptSession` → `gridText` (same file)
- `adoptSession` → `kill` (same file)
- `adoptSession` → `log` (same file)
- `createAndBoot` → `arg` (same file)
- `createAndBoot` → `enter` (same file)
- `createAndBoot` → `gridText` (same file)
- `createAndBoot` → `kill` (same file)
- `createAndBoot` → `log` (same file)
- `createAndBoot` → `postJson` (same file)
- `createAndBoot` → `send` (same file)
- `createAndBoot` → `sleep` (same file)
- `enter` → `postJson` (same file)
- `gridText` → `api` (same file)
- `kill` → `api` (same file)
- `main` → `adoptSession` (same file)
- `main` → `createAndBoot` (same file)
- `main` → `kill` (same file)
- `main` → `log` (same file)
- `main` → `runTurn` (same file)
- `paste` → `postJson` (same file)
- `postJson` → `api` (same file)
- `runTurn` → `captureResponse` (same file)
- `runTurn` → `enter` (same file)
- `runTurn` → `gridText` (same file)
- `runTurn` → `hasResponse` (same file)
- `runTurn` → `hasSpinner` (same file)
- `runTurn` → `log` (same file)
- `runTurn` → `normalize` (same file)
- `runTurn` → `paste` (same file)
- `runTurn` → `sleep` (same file)
- `send` → `postJson` (same file)

## Called by
- `CopilotHandler.query` in [src/copilot-handler.ts](/src/copilot-handler.md)
- `Logger.debug` in [src/logger.ts](/src/logger.md)
- `Logger.info` in [src/logger.ts](/src/logger.md)
- `isAlive` in [src/single-instance.test.ts](/src/single-instance.test.md)
- `killInstance` in [src/single-instance.ts](/src/single-instance.md)

# Explanation
This is the reusable runner behind epic claw-hvpv's cost migration: it
replaces API-billed `claude -p` calls in claudeclaw's launchd job
scripts (morning-brief, email-triage, finance-ingest, health-weekly,
retrospective, ai-digest) with a $0 turn through a persistent,
webterm-hosted INTERACTIVE claude session running under the OAuth/Max
subscription — interactive REPL usage stayed flat-rate when the
headless/SDK path became metered per-token on 2026-06-15.
claudeclaw's scripts/lib/webterm-session.sh sources a thin
`claude_via_webterm` wrapper that shells out to this script. A future
reader should know the job's side effects (its MCP tool calls — Gmail,
Slack, Calendar, memory) are the actual product; the script's stdout
capture of the assistant's text is best-effort logging only, not a
consumed data contract (the old headless path's JSON output wasn't
consumed downstream either).

# Decisions
- (BACKFILL-slackbot-05) (1) Completion detection is entirely structural (a response block
present + no ACTIVE spinner + the normalized grid unchanged for
STABLE_POLLS=4 consecutive 2s polls), NOT echo-anchored — job prompts
can be 40+ lines and claude's terminal echo of a long paste wraps
unpredictably, making a prompt-marker + text match (which the
interactive-chat path can rely on for short prompts) unreliable here.
(2) The ACTIVE_SPINNER vs ANY_SPINNER distinction fixes a real bug: a
glyph followed by a verb ending in an ellipsis ("Cogitating…") means
claude is working, but the visually similar COMPLETED indicator
("Cogitated for 3s") persists on screen once idle and must NOT be
treated as "still working" — an earlier version that didn't
distinguish these two forms made completion detection never fire.
(3) normalize() strips the wall-clock tick, spinner durations,
token/cost meters, and ms timings before the grid-stability
comparison — without this, raw grid equality across polls never holds
because the status line changes every second even at rest, defeating
the whole stability check. (4) After a FRESH boot (not an adopted warm
session), the runner sleeps an extra --mcp-settle-ms (default
12000ms) before sending the job prompt, because the claude.ai MCP
suite (Gmail/Slack/Calendar/Drive/Notion) connects asynchronously
after the prompt box first appears — sending the prompt immediately
makes the job's own tool calls fail against not-yet-connected servers;
adopted warm sessions skip this because their MCP is already up.
(5) gridText() fetches the terminal contents wrapped in one-time nonce
delimiters (`?delimit=nonce`) and validates the closing marker before
returning the body — since this text is fed to an LLM (claude, reading
its own screen) downstream, a compromised or malicious TUI process
could otherwise forge output designed to smuggle instructions past the
boundary; a forged/truncated delimiter throws rather than silently
accepting untrusted content, though it falls back to the raw body on
pre-nonce webterm servers for backward compatibility. (6) Sessions are
only killed at the end if THIS run created them (not if it adopted a
pre-existing warm one) and only when --keep-alive is absent, so a
deliberately kept-warm session isn't torn down by a later run that
adopts it and then fails.

# Citations
[1] BACKFILL-slackbot-05 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot05-evidence.yml
