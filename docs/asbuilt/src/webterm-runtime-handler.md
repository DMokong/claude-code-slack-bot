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
  - BACKFILL-slackbot-06
explains:
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.buildBootCmd
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.buildBootCtx
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.completeBootHandshake
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.createSession
  - src/webterm-runtime-handler.ts#WebtermRuntimeHandler.fetchGridForRelay
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
graph_hash: 9cd2e3defa5347c10e51dc358573f5528b52d3c8949ce203c6a1e4bca5bc6fec
---

# Structure

## Exports
- `HandleMessageOpts` (interface, lines 146-154)
- `WebtermRuntimeHandler` (class, lines 161-1115)
- `WebtermRuntimeOpts` (interface, lines 88-129)
- `decodeSlackEntities` (function, lines 1128-1132)
- `deliver` (const, lines 319-319)
- `shellSingleQuote` (function, lines 1119-1121)
- `stopStatus` (const, lines 315-318)
- `stripTransportSuffix` (function, lines 1137-1139)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `HandleMessageOpts` | interface | 146-154 | yes |
| `InternalOpts` | interface | 156-159 | no |
| `WebtermRuntimeHandler` | class | 161-1115 | yes |
| `WebtermRuntimeHandler._sessionCount` | method | 1112-1114 | yes |
| `WebtermRuntimeHandler.adoptOrCreateSession` | method | 779-788 | yes |
| `WebtermRuntimeHandler.buildBootCmd` | method | 775-777 | yes |
| `WebtermRuntimeHandler.buildBootCtx` | method | 766-773 | yes |
| `WebtermRuntimeHandler.checkInputResponse` | method | 989-1004 | yes |
| `WebtermRuntimeHandler.completeBootHandshake` | method | 750-761 | yes |
| `WebtermRuntimeHandler.constructor` | method | 174-213 | yes |
| `WebtermRuntimeHandler.createSession` | method | 863-912 | yes |
| `WebtermRuntimeHandler.deliverReply` | method | 571-583 | yes |
| `WebtermRuntimeHandler.fetchExitCause` | method | 495-506 | yes |
| `WebtermRuntimeHandler.fetchGridForRelay` | method | 589-600 | yes |
| `WebtermRuntimeHandler.fetchGridMeta` | method | 1006-1016 | yes |
| `WebtermRuntimeHandler.fetchGridText` | method | 1018-1020 | yes |
| `WebtermRuntimeHandler.fetchScrollback` | method | 1028-1039 | yes |
| `WebtermRuntimeHandler.handleMessage` | method | 219-270 | yes |
| `WebtermRuntimeHandler.isRunningClaude` | method | 294-301 | yes |
| `WebtermRuntimeHandler.killWebtermSession` | method | 1041-1043 | yes |
| `WebtermRuntimeHandler.postFreshStreamMessage` | method | 712-727 | yes |
| `WebtermRuntimeHandler.postReply` | method | 1059-1073 | yes |
| `WebtermRuntimeHandler.postStatusPlaceholder` | method | 514-529 | yes |
| `WebtermRuntimeHandler.reapIdleSessions` | method | 792-818 | yes |
| `WebtermRuntimeHandler.relayNewSegments` | method | 627-708 | yes |
| `WebtermRuntimeHandler.resolveSession` | method | 272-290 | yes |
| `WebtermRuntimeHandler.runSseListener` | method | 914-956 | yes |
| `WebtermRuntimeHandler.runStatusLoop` | method | 534-567 | yes |
| `WebtermRuntimeHandler.sendInput` | method | 958-974 | yes |
| `WebtermRuntimeHandler.sendKeys` | method | 976-983 | yes |
| `WebtermRuntimeHandler.shutdown` | method | 1078-1109 | yes |
| `WebtermRuntimeHandler.streamEnabled` | method | 508-510 | yes |
| `WebtermRuntimeHandler.takeTurn` | method | 303-454 | yes |
| `WebtermRuntimeHandler.threadKey` | method | 215-217 | yes |
| `WebtermRuntimeHandler.tryAdoptSession` | method | 824-861 | yes |
| `WebtermRuntimeHandler.updateStreamMessage` | method | 733-743 | yes |
| `WebtermRuntimeHandler.waitForPromptReady` | method | 1045-1057 | yes |
| `WebtermRuntimeHandler.waitForTurnSignal` | method | 461-491 | yes |
| `WebtermRuntimeOpts` | interface | 88-129 | yes |
| `WebtermSession` | interface | 131-144 | no |
| `decodeSlackEntities` | function | 1128-1132 | yes |
| `deliver` | const | 319-319 | yes |
| `shellSingleQuote` | function | 1119-1121 | yes |
| `sleep` | function | 1141-1143 | no |
| `stopStatus` | const | 315-318 | yes |
| `stripTransportSuffix` | function | 1137-1139 | yes |

## Calls out
- `WebtermRuntimeHandler.adoptOrCreateSession` → `WebtermRuntimeHandler.createSession` (same file)
- `WebtermRuntimeHandler.adoptOrCreateSession` → `WebtermRuntimeHandler.tryAdoptSession` (same file)
- `WebtermRuntimeHandler.buildBootCmd` → `WebtermRuntimeHandler.buildBootCtx` (same file)
- `WebtermRuntimeHandler.buildBootCmd` → `shellSingleQuote` (same file)
- `WebtermRuntimeHandler.completeBootHandshake` → `WebtermRuntimeHandler.fetchGridText` (same file)
- `WebtermRuntimeHandler.completeBootHandshake` → `WebtermRuntimeHandler.sendKeys` (same file)
- `WebtermRuntimeHandler.completeBootHandshake` → `WebtermRuntimeHandler.waitForPromptReady` (same file)
- `WebtermRuntimeHandler.constructor` → `WebtermRuntimeHandler.reapIdleSessions` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.buildBootCmd` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.buildBootCtx` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.completeBootHandshake` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.runSseListener` (same file)
- `WebtermRuntimeHandler.createSession` → `WebtermRuntimeHandler.sendInput` (same file)
- `WebtermRuntimeHandler.deliverReply` → `WebtermRuntimeHandler.postReply` (same file)
- `WebtermRuntimeHandler.fetchGridForRelay` → [extractSegments](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.fetchGridForRelay` → `WebtermRuntimeHandler.fetchGridMeta` (same file)
- `WebtermRuntimeHandler.fetchGridForRelay` → `WebtermRuntimeHandler.fetchScrollback` (same file)
- `WebtermRuntimeHandler.fetchGridText` → `WebtermRuntimeHandler.fetchGridMeta` (same file)
- `WebtermRuntimeHandler.handleMessage` → `decodeSlackEntities` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.isRunningClaude` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.postReply` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.resolveSession` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.takeTurn` (same file)
- `WebtermRuntimeHandler.handleMessage` → `WebtermRuntimeHandler.threadKey` (same file)
- `WebtermRuntimeHandler.isRunningClaude` → `WebtermRuntimeHandler.fetchGridText` (same file)
- `WebtermRuntimeHandler.reapIdleSessions` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → `deliver` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → [extractSegments](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.relayNewSegments` → `WebtermRuntimeHandler.postFreshStreamMessage` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → `WebtermRuntimeHandler.postReply` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → `stopStatus` (same file)
- `WebtermRuntimeHandler.relayNewSegments` → `WebtermRuntimeHandler.updateStreamMessage` (same file)
- `WebtermRuntimeHandler.resolveSession` → `WebtermRuntimeHandler.adoptOrCreateSession` (same file)
- `WebtermRuntimeHandler.runStatusLoop` → [extractActivity](/src/webterm-claude-extractor.md)
- `WebtermRuntimeHandler.runStatusLoop` → `WebtermRuntimeHandler.fetchGridText` (same file)
- `WebtermRuntimeHandler.runStatusLoop` → `sleep` (same file)
- `WebtermRuntimeHandler.sendInput` → `WebtermRuntimeHandler.checkInputResponse` (same file)
- `WebtermRuntimeHandler.sendInput` → `WebtermRuntimeHandler.sendKeys` (same file)
- `WebtermRuntimeHandler.sendInput` → `sleep` (same file)
- `WebtermRuntimeHandler.sendKeys` → `WebtermRuntimeHandler.checkInputResponse` (same file)
- `WebtermRuntimeHandler.shutdown` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.shutdown` → `sleep` (same file)
- `WebtermRuntimeHandler.takeTurn` → `deliver` (same file)
- `WebtermRuntimeHandler.takeTurn` → `WebtermRuntimeHandler.deliverReply` (same file)
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
- `WebtermRuntimeHandler.tryAdoptSession` → `WebtermRuntimeHandler.killWebtermSession` (same file)
- `WebtermRuntimeHandler.tryAdoptSession` → `WebtermRuntimeHandler.runSseListener` (same file)
- `WebtermRuntimeHandler.waitForPromptReady` → `sleep` (same file)
- `WebtermRuntimeHandler.waitForTurnSignal` → `sleep` (same file)
- `decodeSlackEntities` → `stripTransportSuffix` (same file)
- `deliver` → `WebtermRuntimeHandler.deliverReply` (same file)

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
WebtermRuntimeHandler is the alternative-to-the-SDK execution path: instead of a fresh headless claude -p invocation per message, it drives one long-lived, interactive claude REPL per Slack thread inside a webterm-hosted PTY, and infers everything about that REPL's state (booted? idle? mid-response? wedged? did claude even survive?) by scraping its rendered terminal grid over HTTP — a future reader should understand this as fundamentally a screen-scraping integration, not an API integration, because there is no structured protocol between this handler and claude, only rendered text.

# Decisions
- (BACKFILL-slackbot-02) (1) Session identity rides on webterm's own "title" field (`slack-bot <channel>::<thread>`), not a separately persisted map — this is what lets a restarted bot process re-adopt an in-progress conversation (`tryAdoptSession`) after `launchd kickstart -k`, since webterm itself outlives the bot process. Anyone changing the title format must also handle migrating or invalidating already-running sessions. (2) Turn completion is inferred, not signaled: claude's TUI removes its spinner while STILL streaming prose (observed empirically, claw-gxzq), so a single idle-looking grid frame is unreliable — the loop requires `IDLE_STABLE_POLLS` (2) consecutive idle observations with no grid change in between, plus (when the server reports it) enough elapsed time since the PTY's last output (`idleOutputFloorMs`) to rule out a mid-paint pause. Loosening this to a single idle frame will truncate multi-part answers. (3) There is deliberately no fixed per-turn timeout — long agentic tool runs can stream for minutes — only a sliding-inactivity "wedged" guard (`slidingInactivityMs`, 5 min) that only trips when the grid stops changing AND claude isn't idle; a live tool run keeps something moving (a spinner, output) so it never trips this. (4) Direct-spawn mode (`directSpawnCommand`) exists specifically to close a structural hole in legacy mode: if claude dies inside a shell-typed session, the PTY falls through to a bare shell that would EXECUTE the next Slack message as a shell command. Making claude the PTY's own argv[0] means there's no shell to fall through to. `isRunningClaude`'s model-status-row check (`CLAUDE_CHROME_RE`) is the runtime guard for the legacy-mode case where direct-spawn isn't configured. (5) The trust-folder dialog is grid-stable (looks like a settled prompt), so `completeBootHandshake` must explicitly pattern-match its text and send Enter to accept it — without this, boot would appear to succeed while claude sat blocked behind a modal, and a user's first message would be typed into the dialog instead of claude (claw-akpn was exactly this bug). (6) `shutdown()` leaves webterm sessions ALIVE by default and only drains in-flight turns for `SHUTDOWN_DRAIN_MS` (5s) — both are deliberate: Slack already acked the event that triggered an in-flight turn, so a dropped reply never redelivers (claw-wb4a), and killing sessions on every restart would defeat the whole point of title adoption.
- (BACKFILL-slackbot-06) 2026-07-06 (claw-3t2q items 1/5, commit 74de1b75): awaitRenderSettled and fetchAndExtract — a poll-until-two-consecutive-snapshots-match-then-extract-once pair — were deleted as confirmed dead code: awaitRenderSettled had zero callers, and it was fetchAndExtract's only caller, so both went together, along with the now-orphaned ExtractedTurn type import. Both had already been functionally superseded by the continuous-relay design (takeTurn + relayNewSegments), which polls and posts prose blocks incrementally as they settle instead of polling-until-fully-settled-then-extracting-the-whole-turn-once. fetchGridText and fetchScrollback were kept — both still have live callers today (fetchGridText: isRunningClaude, completeBootHandshake, runStatusLoop; fetchScrollback: fetchGridForRelay) — independently re-verified here by reading the current file rather than trusting the commit message's claim alone. A leftover from that removal worth flagging for a future reader: two comments still name the deleted functions by name — fetchGridForRelay's docstring says it 'Mirrors fetchAndExtract's recovery,' and shutdown's comment attributes partial-content delivery to 'awaitRenderSettled exits and it delivers what it has' — neither function exists anymore. The behavior these comments describe is still correct in spirit (fetchGridForRelay does the same scrollback-recovery trick fetchAndExtract used to do; shutdown's actual partial-delivery path runs through takeTurn's own idle/inactivity checks), but grepping for either removed name to understand these comments will come up empty — the prose needs a follow-up edit, not the logic. Separately: the same-window permission-flow removal (claw-3t2q item 4) did NOT touch this file — DEFAULT_CLAUDE_CMD's '--dangerously-skip-permissions' flag is a CLI boot argument for the persistent REPL, deliberately unrelated to the deleted permission-approval integration, and the removal commit explicitly called it out as staying as-is. Two longer-standing design decisions worth preserving here: session identity rides entirely on webterm's own session 'title' field ('slack-bot <channel>::<thread>'), not a separately persisted map, which is what lets a restarted bot process re-adopt an in-progress conversation via tryAdoptSession since webterm itself outlives the bot process; and takeTurn deliberately has no fixed per-turn timeout, only a sliding-inactivity 'wedged' guard, because long agentic tool runs can legitimately stream for many minutes without the grid going idle.

# Citations
[1] BACKFILL-slackbot-02 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot02-evidence.yml
[2] BACKFILL-slackbot-06 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot06-evidence.yml
