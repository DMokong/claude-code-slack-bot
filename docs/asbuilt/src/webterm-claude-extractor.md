---
type: Module
title: src/webterm-claude-extractor.ts
description: Skeleton concept for src/webterm-claude-extractor.ts (extracted; 22 symbols).
resource: src/webterm-claude-extractor.ts
tags:
  - src
  - module
  - const
  - function
  - interface
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-02
explains:
  - src/webterm-claude-extractor.ts#displayWidth
  - src/webterm-claude-extractor.ts#extractActivity
  - src/webterm-claude-extractor.ts#extractSegments
  - src/webterm-claude-extractor.ts#extractTurn
  - src/webterm-claude-extractor.ts#findBottomPromptRow
  - src/webterm-claude-extractor.ts#findEchoEnd
  - src/webterm-claude-extractor.ts#findFooterStart
  - src/webterm-claude-extractor.ts#findLastUserEcho
  - src/webterm-claude-extractor.ts#formatTurnForSlack
  - src/webterm-claude-extractor.ts#isGridIdle
  - src/webterm-claude-extractor.ts#isWideCodePoint
  - src/webterm-claude-extractor.ts#unwrapWordWrap
  - src/webterm-claude-extractor.ts#walkTurn
stale: false
stale_reason: ""
graph_hash: 8a0d575a40873cd07242dedf282b03d07a103f46e0d9f41720eeb5c6f031704a
---

# Structure

## Exports
- `ExtractOptions` (interface, lines 20-26)
- `ExtractedTurn` (interface, lines 11-18)
- `Segment` (interface, lines 29-32)
- `displayWidth` (function, lines 223-230)
- `extractActivity` (function, lines 497-515)
- `extractSegments` (function, lines 388-428)
- `extractTurn` (function, lines 340-382)
- `formatTurnForSlack` (function, lines 457-464)
- `isGridIdle` (function, lines 446-451)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `ExtractOptions` | interface | 20-26 | yes |
| `ExtractedTurn` | interface | 11-18 | yes |
| `Segment` | interface | 29-32 | yes |
| `WalkResult` | interface | 282-286 | no |
| `cur` | const | 300-300 | no |
| `displayWidth` | function | 223-230 | yes |
| `extractActivity` | function | 497-515 | yes |
| `extractSegments` | function | 388-428 | yes |
| `extractTurn` | function | 340-382 | yes |
| `findBottomPromptRow` | function | 181-194 | no |
| `findEchoEnd` | function | 140-173 | no |
| `findFooterStart` | function | 101-113 | no |
| `findLastUserEcho` | function | 118-135 | no |
| `formatTurnForSlack` | function | 457-464 | yes |
| `isAnswerEnd` | function | 83-85 | no |
| `isChrome` | function | 54-56 | no |
| `isGridIdle` | function | 446-451 | yes |
| `isPromptLine` | function | 68-73 | no |
| `isRule` | function | 60-62 | no |
| `isWideCodePoint` | function | 200-216 | no |
| `unwrapWordWrap` | function | 241-272 | no |
| `walkTurn` | function | 288-338 | no |

## Calls out
- `displayWidth` → `isWideCodePoint` (same file)
- `extractSegments` → `displayWidth` (same file)
- `extractSegments` → `findBottomPromptRow` (same file)
- `extractSegments` → `findEchoEnd` (same file)
- `extractSegments` → `findFooterStart` (same file)
- `extractSegments` → `findLastUserEcho` (same file)
- `extractSegments` → `unwrapWordWrap` (same file)
- `extractSegments` → `walkTurn` (same file)
- `extractTurn` → `displayWidth` (same file)
- `extractTurn` → `findBottomPromptRow` (same file)
- `extractTurn` → `findEchoEnd` (same file)
- `extractTurn` → `findFooterStart` (same file)
- `extractTurn` → `findLastUserEcho` (same file)
- `extractTurn` → `unwrapWordWrap` (same file)
- `extractTurn` → `walkTurn` (same file)
- `findBottomPromptRow` → `isPromptLine` (same file)
- `findBottomPromptRow` → `isRule` (same file)
- `findFooterStart` → `isRule` (same file)
- `isGridIdle` → `findBottomPromptRow` (same file)
- `unwrapWordWrap` → `displayWidth` (same file)
- `walkTurn` → `cur` (same file)
- `walkTurn` → `isAnswerEnd` (same file)
- `walkTurn` → `isChrome` (same file)
- `walkTurn` → `isPromptLine` (same file)

## Called by
- `main` in [scripts/healthcheck-webterm-claude.ts](/scripts/healthcheck-webterm-claude.md)
- `main` in [scripts/healthcheck-webterm-claude.ts](/scripts/healthcheck-webterm-claude.md)
- `WebtermRuntimeHandler.fetchGridForRelay` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.relayNewSegments` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.runStatusLoop` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.takeTurn` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.takeTurn` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)
- `WebtermRuntimeHandler.takeTurn` in [src/webterm-runtime-handler.ts](/src/webterm-runtime-handler.md)

# Explanation
This module is the sole translator between "what a headless xterm buffer running claude's TUI looks like" and "what Slack should show." It exists because the underlying webterm session exposes no structured event stream for claude's responses — only a periodically-fetchable snapshot of rendered screen text — so every extraction here is pattern-matching against how claude's specific terminal UI happens to render, at a specific version. A future reader touching this file should assume it is coupled to claude CLI's TUI rendering and will need re-verification (via `test/fixtures/webterm-grids/`) whenever that TUI changes materially.

# Decisions
- (BACKFILL-slackbot-02) (1) The chrome/spinner/prompt regexes (`CHROME_RULES`, `SPINNER_GLYPHS`, `TRUST_DIALOG_RE`-adjacent patterns in the runtime handler) were captured empirically from live claude CLI output across several model families (Opus/Fable/Sonnet/Haiku/Mythos) — they are not derived from any published spec and are expected to need updates as claude's rendering evolves. (2) `isPromptLine` must check for a NON-BREAKING SPACE (U+00A0) after the prompt marker, not just a regular space — claude renders NBSP there, and an earlier version of this check using only `"❯ "` let dimmed ghost-suggestion text leak into extracted content. (3) The `⏺ Tool(args)` vs `⏺ prose` split (`TOOL_LINE_BODY_RE = /^\w+\(/`) is deliberately a cheap heuristic — a word immediately followed by `(` — rather than a maintained list of known tool names, so it's robust to new tools but could misfire on prose that happens to open with `Word(`. (4) `unwrapWordWrap` measures line width in terminal COLUMNS via `displayWidth`/`isWideCodePoint`, not `String.length`, because a CJK-heavy row renders at roughly half the String.length would suggest (2 columns/glyph) — measuring with `.length` made genuinely-wrapped CJK prose look far short of the wrap threshold and mangled paragraph joins (claw-3btg.5). (5) Two separate spinner regexes exist for "actively working" vs "just finished" specifically because an end-of-line-anchored ellipsis match missed claude's live spinner suffix (`"✳ Nesting… (5s · ↓ 205 tokens)"`), which caused the relay loop to finalize a Slack message while claude was still generating (claw-gxzq) — the fix was to match "glyph + word + …" anywhere on the line rather than anchoring to end-of-string. (6) `walkTurn` treats a `※`/spinner line as entering a skippable "chrome" state rather than ending the walk, because real assistant content can render AFTER a tip line; an earlier implementation that terminated on the first such line silently dropped trailing content.

# Citations
[1] BACKFILL-slackbot-02 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot02-evidence.yml
