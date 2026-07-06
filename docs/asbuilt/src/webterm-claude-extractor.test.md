---
type: Module
title: src/webterm-claude-extractor.test.ts
description: Skeleton concept for src/webterm-claude-extractor.test.ts
  (extracted; 2 symbols).
resource: src/webterm-claude-extractor.test.ts
tags:
  - src
  - module
  - function
  - interface
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-04
explains:
  - src/webterm-claude-extractor.test.ts#Fixture
  - src/webterm-claude-extractor.test.ts#loadFixture
stale: false
stale_reason: ""
graph_hash: 9759b135c07f30574b7bf7d243258420038465ac1a4c3772e3f14e18ef5df067
---

# Structure

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `Fixture` | interface | 8-13 | no |
| `loadFixture` | function | 15-29 | no |

# Explanation
This module and its test suite exist because a webterm-hosted `claude` CLI session's raw ANSI output-chunk bytes are unreadable (the TUI is cursor-positioned, not line-appended) — the only readable primitive is webterm's already-rendered grid text (`GET /api/sessions/:id/text`), and this extractor is the entire boundary between that raw rendered screen and clean text a human reads in Slack. A future reader should understand this file as "screen-scraping a live TUI, adversarially, against a terminal app that was never designed to be scraped" — nearly every function exists to correct for one specific rendering behavior that wasn't obvious until observed live.

# Decisions
- (BACKFILL-slackbot-04) The single hardest-won invariant in this file, backed by real captured frame sequences (test/fixtures/webterm-grids/08-*, 09-*): claude REMOVES its own spinner glyph from the grid while it is still actively streaming prose into the transcript. This means `isGridIdle` returning true on a single frame is NOT proof the turn is done — it's frequently a mid-render pause. Any caller of this module's idle-detection functions (currently only webterm-runtime-handler.ts) MUST require several consecutive idle observations with an unchanged grid before treating a turn as complete; a caller that finalizes on one idle frame will routinely ship partial answers. Second gotcha: claude renders a NON-BREAKING SPACE (U+00A0), not a regular space, after the `❯` prompt marker when showing a dimmed input suggestion — code checking for the bottom input box must accept space, NBSP, or tab after the marker (`isPromptLine`), or suggestion text leaks into extracted answers. Third: display width for word-wrap detection must count Unicode code points by East-Asian-wide-ness (`displayWidth`), not `.length` — CJK text occupies 2 grid columns per glyph, and the wrap threshold is a COLUMN measurement, not a character-count measurement.

# Citations
[1] BACKFILL-slackbot-04 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot04-evidence.yml
