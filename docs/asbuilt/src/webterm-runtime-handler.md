---
type: Module
title: src/webterm-runtime-handler.ts
description: Skeleton concept for src/webterm-runtime-handler.ts (extracted; 48 symbols).
resource: src/webterm-runtime-handler.ts
tags:
  - src
  - module
  - class
  - const
  - function
  - interface
  - method
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-02
explains:
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.buildBootCmd
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.buildBootCtx
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.completeBootHandshake
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.createSession
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.handleMessage
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.isRunningClaude
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.reapIdleSessions
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.relayNewSegments
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.resolveSession
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.sendInput
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.shutdown
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.takeTurn
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.tryAdoptSession
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.waitForTurnSignal
  - src/webterm-runtime-handler.ts#decodeSlackEntities
  - src/webterm-runtime-handler.ts#shellSingleQuote
  - src/webterm-runtime-handler.ts#stripTransportSuffix
stale: false
stale_reason: ""
graph_hash: 9759b135c07f30574b7bf7d243258420038465ac1a4c3772e3f14e18ef5df067
---

# Structure

## Exports
- `HandleMessageOpts` (interface, lines 146-154)
- `WebtermRuntimeHandler` (class, lines 161-1166)
- `WebtermRuntimeOpts` (interface, lines 88-129)
- `decodeSlackEntities` (function, lines 1179-1183)
- `deliver` (const, lines 319-319)
- `shellSingleQuote` (function, lines 1170-1172)
- `stopStatus` (const, lines 315-318)
- `stripTransportSuffix` (function, lines 1188-1190)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `HandleMessageOpts` | interface | 146-154 | yes |
| `InternalOpts` | interface | 156-159 | no |
| `WebtermRuntimeHandler` | class | 161-1166 | yes |
| `WebtermRuntimeHandler._sessionCount` | method | 1163-1165 | yes |
| `WebtermRuntimeHandler.adoptOrCreateSession` | method | 807-816 | yes |
| `WebtermRuntimeHandler.awaitRenderSettled` | method | 588-611 | yes |
| `WebtermRuntimeHandler.buildBootCmd` | method | 803-805 | yes |
| `WebtermRuntimeHandler.buildBootCtx` | method | 794-801 | yes |
| `WebtermRuntimeHandler.checkInputResponse` | method | 1017-1032 | yes |
| `WebtermRuntimeHandler.completeBootHandshake` | method | 778-789 | yes |
| `WebtermRuntimeHandler.constructor` | method | 174-213 | yes |
| `WebtermRuntimeHandler.createSession` | method | 891-940 | yes |
| `WebtermRuntimeHandler.deliverReply` | method | 571-583 | yes |
| `WebtermRuntimeHandler.fetchAndExtract` | method | 1082-1089 | yes |
| `WebtermRuntimeHandler.fetchExitCause` | method | 495-506 | yes |
| `WebtermRuntimeHandler.fetchGridForRelay` | method | 617-628 | yes |
| `WebtermRuntimeHandler.fetchGridMeta` | method | 1034-1044 | yes |
| `WebtermRuntimeHandler.fetchGridText` | method | 1046-1048 | yes |
| `WebtermRuntimeHandler.fetchScrollback` | method | 1056-1067 | yes |
| `WebtermRuntimeHandler.handleMessage` | method | 219-270 | yes |
| `WebtermRuntimeHandler.isRunningClaude` | method | 294-301 | yes |
| `WebtermRuntimeHandler.killWebtermSession` | method | 1091-1093 | yes |
| `WebtermRuntimeHandler.postFreshStreamMessage` | method | 740-755 | yes |
| `WebtermRuntimeHandler.postReply` | method | 1109-1123 | yes |
| `WebtermRuntimeHandler.postStatusPlaceholder` | method | 514-529 | yes |
| `WebtermRuntimeHandler.reapIdleSessions` | method | 820-846 | yes |
| `WebtermRuntimeHandler.relayNewSegments` | method | 655-736 | yes |
| `WebtermRuntimeHandler.resolveSession` | method | 272-290 | yes |
| `WebtermRuntimeHandler.runSseListener` | method | 942-984 | yes |
| `WebtermRuntimeHandler.runStatusLoop` | method | 534-567 | yes |
| `WebtermRuntimeHandler.sendInput` | method | 986-1002 | yes |
| `WebtermRuntimeHandler.sendKeys` | method | 1004-1011 | yes |
| `WebtermRuntimeHandler.shutdown` | method | 1128-1160 | yes |
| `WebtermRuntimeHandler.streamEnabled` | method | 508-510 | yes |
| `WebtermRuntimeHandler.takeTurn` | method | 303-454 | yes |
| `WebtermRuntimeHandler.threadKey` | method | 215-217 | yes |
| `WebtermRuntimeHandler.tryAdoptSession` | method | 852-889 | yes |
| `WebtermRuntimeHandler.updateStreamMessage` | method | 761-771 | yes |
| `WebtermRuntimeHandler.waitForPromptReady` | method | 1095-1107 | yes |
| `WebtermRuntimeHandler.waitForTurnSignal` | method | 461-491 | yes |
| `WebtermRuntimeOpts` | interface | 88-129 | yes |
| `WebtermSession` | interface | 131-144 | no |
| `decodeSlackEntities` | function | 1179-1183 | yes |
| `deliver` | const | 319-319 | yes |
| `shellSingleQuote` | function | 1170-1172 | yes |
| `sleep` | function | 1192-1194 | no |
| `stopStatus` | const | 315-318 | yes |
| `stripTransportSuffix` | function | 1188-1190 | yes |

## Calls out
- `WebtermRuntimeHandler.adoptOrCreateSession` → `WebtermRuntimeHandler.createSession` (same file)
- `WebtermRuntimeHandler.adoptOrCreateSession` → `WebtermRuntimeHandler.tryAdoptSession` (same file)
- `WebtermRuntimeHandler.awaitRenderSettled` → `WebtermRuntimeHandler.fetchAndExtract` (same file)
- `WebtermRuntimeHandler.awaitRenderSettled` → [Logger.info](/src/logger.md)
- `WebtermRuntimeHandler.awaitRenderSettled` → `sleep` (same file)
- `WebtermRuntimeHandler.buildBootCmd` → `WebtermRuntimeHandler.buildBootCtx` (same file)
- `WebtermRuntimeHandler.buildBootCmd` → `shellSingleQuote` (same file)
- `WebtermRuntimeHandler.checkInputResponse` → [Logger.warn](/src/logger.md)
- `WebtermRuntimeHandler.completeBootHandshake` → `WebtermRuntimeHandler.fetchGridText` (same file)
- `WebtermRuntimeHandler.completeBootHandshake` → [Logger.info](/src/logger.md)
- `WebtermRuntimeHandler.completeBootHandshake` → `WebtermRuntimeHandler.sendKeys` (same file)
- `WebtermRuntimeHandler.completeBootHandshake` → `WebtermRuntimeHandler.waitForPromptReady` (same file)
- `WebtermRuntimeHandler.constructor` → [Logger.error](/src/logger.md)
- `WebtermRuntimeHandler.constructor` → `WebtermRuntimeHandler.reapIdleSessions` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.buildBootCmd` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.buildBootCtx` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.completeBootHandshake` (same file)
- `WebtermRuntimeHandler.createSession` → [Logger.info](/src/logger.md)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.runSseListener` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.sendInput` (same file)
- `WebtermRuntimeHandler.deliverReply` → [Logger.error](/src/logger.md)
- `WebtermRuntimeHandler.deliverReply` → `WebtermRuntimeHandler.postReply` (same file)
- `WebtermRuntimeHandler.fetchAndExtract` → [extractTurn](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.fetchAndExtract` → `WebtermRuntimeHandler.fetchGridText` (same file)
- `WebtermRuntimeHandler.fetchAndExtract` → `WebtermRuntimeHandler.fetchScrollback` (same file)
- `WebtermRuntimeHandler.fetchGridForRelay` → [extractSegments](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.fetchGridForRelay` → `WebtermRuntimeHandler.fetchGridMeta` (same file)
- `WebtermRuntimeHandler.fetchGridForRelay` → `WebtermRuntimeHandler.fetchScrollback` (same file)
- `WebtermRuntimeHandler.fetchGridText` → `WebtermRuntimeHandler.fetchGridMeta` (same file)
- `WebtermRuntimeHandler.handleMessage` → `decodeSlackEntities` (same file)
- `WebtermRuntimeHandler.handleMessage` → [Logger.error](/src/logger.md)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.isRunningClaude` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.postReply` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.resolveSession` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.takeTurn` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.threadKey` (same file)
- `WebtermRuntimeHandler.handleMessage` → [Logger.warn](/src/logger.md)
- `WebtermRuntimeHandler.isRunningClaude` → `WebtermRuntimeHandler.fetchGridText` (same file)
- `WebtermRuntimeHandler.postFreshStreamMessage` → [Logger.error](/src/logger.md)
- `WebtermRuntimeHandler.postReply` → [Logger.error](/src/logger.md)
- `WebtermRuntimeHandler.postStatusPlaceholder` → [Logger.error](/src/logger.md)
- `WebtermRuntimeHandler.reapIdleSessions` → [Logger.info](/src/logger.md)
- `WebtermRuntimeHandler.reapIdleSessions` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → `deliver` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → [extractSegments](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.relayNewSegments` → `WebtermRuntimeHandler.postFreshStreamMessage` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → `WebtermRuntimeHandler.postReply` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → `stopStatus` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → `WebtermRuntimeHandler.updateStreamMessage` (same file)
- `WebtermRuntimeHandler.resolveSession` → `WebtermRuntimeHandler.adoptOrCreateSession` (same file)
- `WebtermRuntimeHandler.runSseListener` → [Logger.error](/src/logger.md)
- `WebtermRuntimeHandler.runSseListener` → [Logger.info](/src/logger.md)
- `WebtermRuntimeHandler.runStatusLoop` → [extractActivity](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.runStatusLoop` → `WebtermRuntimeHandler.fetchGridText` (same file)
- `WebtermRuntimeHandler.runStatusLoop` → `sleep` (same file)
- `WebtermRuntimeHandler.runStatusLoop` → [Logger.warn](/src/logger.md)
- `WebtermRuntimeHandler.sendInput` → `WebtermRuntimeHandler.checkInputResponse` (same file)
- `WebtermRuntimeHandler.sendInput` → `WebtermRuntimeHandler.sendKeys` (same file)
- `WebtermRuntimeHandler.sendInput` → `sleep` (same file)
- `WebtermRuntimeHandler.sendKeys` → `WebtermRuntimeHandler.checkInputResponse` (same file)
- `WebtermRuntimeHandler.shutdown` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.shutdown` → `sleep` (same file)
- `WebtermRuntimeHandler.takeTurn` → `deliver` (same file)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.deliverReply` (same file)
- `WebtermRuntimeHandler.takeTurn` → [Logger.error](/src/logger.md)
- `WebtermRuntimeHandler.takeTurn` → [extractTurn](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.fetchExitCause` (same file)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.fetchGridForRelay` (same file)
- `WebtermRuntimeHandler.takeTurn` → [formatTurnForSlack](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.takeTurn` → [isGridIdle](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.postStatusPlaceholder` (same file)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.relayNewSegments` (same file)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.runStatusLoop` (same file)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.sendInput` (same file)
- `WebtermRuntimeHandler.takeTurn` → `stopStatus` (same file)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.streamEnabled` (same file)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.waitForTurnSignal` (same file)
- `WebtermRuntimeHandler.tryAdoptSession` → `WebtermRuntimeHandler.fetchGridText` (same file)
- `WebtermRuntimeHandler.tryAdoptSession` → [Logger.info](/src/logger.md)
- `WebtermRuntimeHandler.tryAdoptSession` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.tryAdoptSession` → `WebtermRuntimeHandler.runSseListener` (same file)
- `WebtermRuntimeHandler.tryAdoptSession` → [Logger.warn](/src/logger.md)
- `WebtermRuntimeHandler.updateStreamMessage` → [Logger.warn](/src/logger.md)
- `WebtermRuntimeHandler.waitForPromptReady` → `sleep` (same file)
- `WebtermRuntimeHandler.waitForTurnSignal` → `sleep` (same file)
- `decodeSlackEntities` → `stripTransportSuffix` (same file)
- `deliver` → `WebtermRuntimeHandler.deliverReply` (same file)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
This is the webterm-driven alternative to the `claude -p` SDK path for running Slack conversations: instead of spawning a fresh headless claude invocation per message, it keeps one long-lived, interactive `claude` REPL per Slack thread inside a webterm-hosted PTY, and talks to that REPL by typing input and scraping its rendered terminal grid over HTTP. A future reader should understand this as fundamentally a screen-scraping integration, not an API integration — there is no structured protocol between this handler and claude, only rendered text, which is why `webterm-claude-extractor.ts` (a sibling, tightly-coupled module) exists and why so much of this file's logic is about inferring state (booted? idle? wedged? claude still running?) from grid snapshots rather than being told it directly.

# Decisions
- (BACKFILL-slackbot-02) (1) Session identity rides on webterm's own "title" field (`slack-bot <channel>::<thread>`), not a separately persisted map — this is what lets a restarted bot process re-adopt an in-progress conversation (`tryAdoptSession`) after `launchd kickstart -k`, since webterm itself outlives the bot process. Anyone changing the title format must also handle migrating or invalidating already-running sessions. (2) Turn completion is inferred, not signaled: claude's TUI removes its spinner while STILL streaming prose (observed empirically, claw-gxzq), so a single idle-looking grid frame is unreliable — the loop requires `IDLE_STABLE_POLLS` (2) consecutive idle observations with no grid change in between, plus (when the server reports it) enough elapsed time since the PTY's last output (`idleOutputFloorMs`) to rule out a mid-paint pause. Loosening this to a single idle frame will truncate multi-part answers. (3) There is deliberately no fixed per-turn timeout — long agentic tool runs can stream for minutes — only a sliding-inactivity "wedged" guard (`slidingInactivityMs`, 5 min) that only trips when the grid stops changing AND claude isn't idle; a live tool run keeps something moving (a spinner, output) so it never trips this. (4) Direct-spawn mode (`directSpawnCommand`) exists specifically to close a structural hole in legacy mode: if claude dies inside a shell-typed session, the PTY falls through to a bare shell that would EXECUTE the next Slack message as a shell command. Making claude the PTY's own argv[0] means there's no shell to fall through to. `isRunningClaude`'s model-status-row check (`CLAUDE_CHROME_RE`) is the runtime guard for the legacy-mode case where direct-spawn isn't configured. (5) The trust-folder dialog is grid-stable (looks like a settled prompt), so `completeBootHandshake` must explicitly pattern-match its text and send Enter to accept it — without this, boot would appear to succeed while claude sat blocked behind a modal, and a user's first message would be typed into the dialog instead of claude (claw-akpn was exactly this bug). (6) `shutdown()` leaves webterm sessions ALIVE by default and only drains in-flight turns for `SHUTDOWN_DRAIN_MS` (5s) — both are deliberate: Slack already acked the event that triggered an in-flight turn, so a dropped reply never redelivers (claw-wb4a), and killing sessions on every restart would defeat the whole point of title adoption.

# Citations
[1] BACKFILL-slackbot-02 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot02-evidence.yml
