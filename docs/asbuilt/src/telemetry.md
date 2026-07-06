---
type: Module
title: src/telemetry.ts
description: Skeleton concept for src/telemetry.ts (extracted; 2 symbols).
resource: src/telemetry.ts
tags:
  - src
  - module
  - function
  - interface
enrichment: accuracy-audited
from:
  - BACKFILL-slackbot-03
explains:
  - src/telemetry.ts#QuerySpanResult
  - src/telemetry.ts#withQuerySpan
stale: false
stale_reason: ""
graph_hash: 9cd2e3defa5347c10e51dc358573f5528b52d3c8949ce203c6a1e4bca5bc6fec
---

# Structure

## Exports
- `QuerySpanResult` (interface, lines 49-57)
- `withQuerySpan` (function, lines 66-138)

## Symbols
| Symbol | Kind | Span | Exported |
|---|---|---|---|
| `QuerySpanResult` | interface | 49-57 | yes |
| `withQuerySpan` | function | 66-138 | yes |

## Called by
- `SlackHandler.handleMessage` in [src/slack-handler.ts](/src/slack-handler.md)

# Explanation
This module is the one place OpenTelemetry span/metric creation happens
for Slack query handling - it exists so slack-handler.ts can wrap a
query in `withQuerySpan(...)` without knowing anything about OTel API
shapes, span lifecycle, or which histogram goes with which number. It
is safe to call even when the OTel SDK isn't initialized elsewhere
(src/instrumentation.ts is the actual init point, not one of the nine
files covered here) because the OTel API contract makes uninitialized
tracers/meters no-ops.

# Decisions
- (BACKFILL-slackbot-03) The comment at lines 11-12 - baking unit suffixes into metric *names*
(`_usd`, `_ms`) instead of the OTel `unit:` option - is there because of
a specific, non-obvious OTLP-to-Prometheus conversion behavior: setting
`unit` causes the Prometheus exporter to append its own suffix on top of
one already in the name, double-suffixing it (e.g. something like
`..._usd_usd` or similar mismatch). Anyone "cleaning up" these metric
definitions by moving the unit into the `unit:` field, which looks like
the more idiomatic OTel way to do it, would silently break
dashboards/alerts built against the current metric names. The
`_telemetry` field convention on `withQuerySpan`'s wrapped-function
return value is a deliberate side-channel: it lets the wrapped callback
report cost/token/duration numbers it discovers mid-execution (e.g.
parsed out of an SDK message stream) without changing the callback's
actual return type contract, and `withQuerySpan` strips the field
before returning so callers of `withQuerySpan` never see it leak into
their result type. Two different "how long did this take" numbers exist
side by side: `wall_duration_ms` (always recorded, `finally` block,
measures this function's own wall-clock time) and
`query.duration_ms` (only recorded if the wrapped callback populated
`_telemetry.duration_ms`, presumably a more precise SDK-reported
figure) - don't assume they're interchangeable when reading dashboards
built on these metrics.

# Citations
[1] BACKFILL-slackbot-03 evidence: /Users/dustincheng/projects/claudeclaw/docs/specs/asbuilt-living-kb/evidence/slackbot03-evidence.yml
