# Webterm-driven claude runtime — activation runbook

> Status: **demoable**, not production.
> Tracks: claw-op2n Phase 2 (this is the routing wire-up); claw-r56h (extractor);
> claw-3ju4 (server-side prompt-ready event).

Activates the alternative routing where messages from configured Slack
channels go through a persistent interactive `claude` REPL hosted in webterm
instead of the per-message Claude Code SDK path.

**Defaults:** unset / no channels routed. The bot's existing behavior is
unchanged until you set `WEBTERM_CHANNELS`.

## What you get vs. what's missing

| Have | Don't have (Phase 2 backlog) |
|------|------------------------------|
| Persistent claude REPL per Slack thread | Session↔thread persistence across bot restart (claw-usdo) |
| Warm MCP / tool prompts pre-granted | Tool-permission UX surfaced to Slack (claw-o05f) |
| Server-side prompt-ready turn detection | Trust-folder dialog handling for fresh cwds (claw-g790) |
| Compensating retry on extractor null | Multi-user concurrency hardening |
| In-memory thread→session map | webterm launchd supervisor — must start by hand |

## Prerequisites

1. **webterm running** on the configured URL with the `prompt-ready` SSE event:
   ```bash
   cd ~/projects/webterm
   git checkout main             # prompt-ready merged on 2026-06-04
   pnpm --filter @webterm/server dev
   ```
   Verify: `curl -s http://127.0.0.1:7681/api/health` returns `{"ok":true}`.

2. **`claude` CLI authenticated** under the user the bot runs as. The default
   command is `claude --dangerously-skip-permissions`, which skips per-tool
   permission prompts but **does not** skip the "trust this folder" first-run
   dialog. Use a `WEBTERM_CWD` you've already opened `claude` in once.

3. **A dedicated Slack channel** the bot is a member of. The bot's existing
   `app.message` handler still fires for non-webterm-routed messages, but
   for routed channels the SDK path is skipped entirely.

## Activate

1. Edit `.env`:
   ```env
   WEBTERM_CHANNELS=C0ABCXYZ123
   WEBTERM_URL=http://127.0.0.1:7681
   WEBTERM_CWD=/Users/dustincheng/projects/claudeclaw
   WEBTERM_CLAUDE_CMD=claude --dangerously-skip-permissions
   ```
2. Restart the bot. Look for `Webterm runtime enabled` in the logs — that
   confirms the runtime was instantiated with at least one channel.
3. Post a message in the channel. First message triggers session creation
   (~3–5s to boot claude). Subsequent messages are turns on the warm REPL.

## Deactivate

Unset `WEBTERM_CHANNELS` and restart. The runtime instance won't even be
constructed, so all routing falls through to the SDK path.

## Observability

The handler logs at the `WebtermRuntime` namespace:

- `Webterm runtime enabled` — startup, with configured channels
- `Webterm session ready` — after boot prompt-ready fires
- `Webterm session exited` — SSE `exit` event
- `Stale session, recreating` — session marked dead, re-creates on next msg
- `Extractor returned null (claw-etj7 false-positive?), retrying` — premature
  prompt-ready compensation
- `Session creation failed` / `sendInput failed` / `prompt-ready wait failed` /
  `Exhausted false-positive retries` — error paths; each one also posts a
  `:warning:` reply to the Slack thread

## Known issues

- **claw-etj7**: prompt-ready can fire prematurely before claude has
  produced any visible output. The handler compensates by retrying up to 3
  times when the extractor returns null. If claude actually never responds
  in 180s, the user gets a `:warning:` and the thread can be retried.
- **bot restart loses session map** — first message after restart spawns a
  fresh webterm session, losing the prior claude conversation context.
  Track: claw-usdo.
- **webterm restart leaves orphan sessions in the bot map** — the SSE
  listener will see `exit` and mark sessions dead, so subsequent messages
  recreate. But there's a small window where the bot may try to send input
  to a dead session.
- **No multi-instance support** — if two bots run on the same Slack token
  (which `single-instance.ts` already prevents) and the same webterm URL,
  they'd race over sessions. Inherits the prod bot's single-instance guard.

## Files

- `src/webterm-runtime-handler.ts` — the runtime + state machine (6 tests)
- `src/webterm-claude-extractor.ts` — grid-text → assistant turn (9 tests)
- `src/config.ts` — `config.webterm.{channels,url,cwd,claudeCmd}`
- `src/slack-handler.ts:handleMessage` — early routing check at top of method
