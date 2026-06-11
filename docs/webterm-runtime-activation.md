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

## API authentication (claw-yv02 / claw-0bfv)

The webterm API requires a **bearer token** and enforces a **Host allowlist**
(loopback only) on every request — closing the zero-auth RCE and the
DNS-rebinding drive-by. This is **fail-closed and automatic**:

- On boot the server resolves the token from `WEBTERM_TOKEN` env, else an
  existing `~/.webterm/token`, else it **generates one and writes it** there
  (mode 0600). No manual setup.
- Every local client reads the same token: the **bot** and **healthcheck** via
  `WEBTERM_TOKEN` env or `~/.webterm/token`; the **Vite UI** injects it at the
  proxy layer (the browser never sees it) and uses `changeOrigin` so proxied
  requests pass the Host allowlist; the **CLI** reads it for REST + WS.
- `/api/health` is exempt from the token (still Host-gated) so liveness probes
  work unauthenticated.
- Escape hatch: `WEBTERM_AUTH=off` disables auth entirely (only for an isolated
  deployment where the network already isolates the port).

Quick verify after a restart (expect `401`, then `200`, then `403`):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7681/api/sessions          # 401
T=$(cat ~/.webterm/token)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $T" http://127.0.0.1:7681/api/sessions  # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.com" http://127.0.0.1:7681/api/health             # 403
```

Restart order after a token change or fresh deploy: **server → UI → bot** (the
server writes the token; the UI and bot read it at startup).

## Prerequisites

1. **webterm running** on the configured URL with the `prompt-ready` SSE event.
   There are TWO dev servers — the bot only needs the API one, but the browser
   UI is on a separate port if you want to watch sessions live.

   ```bash
   # terminal A — API server (Fastify on 7681). The bot talks to this.
   cd ~/projects/webterm
   git checkout main             # prompt-ready merged on 2026-06-04
   pnpm dev:server               # → http://127.0.0.1:7681

   # terminal B (optional) — browser UI (Vite on 5173, proxies /api + /ws to 7681)
   pnpm dev:client               # → http://127.0.0.1:5173
   ```

   Verify the API: `curl -s http://127.0.0.1:7681/api/health` returns
   `{"ok":true}`. **Don't browse to 7681 directly** — it's API-only and a GET /
   returns a Fastify 404. The browser UI lives on 5173.

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

## Healthcheck

`scripts/healthcheck-webterm-claude.ts` runs the full pipeline end-to-end
using the same code path the bot uses for routed channels — API reachable,
session create, SSE subscribe with `promptReady=true`, boot, send a known
turn ("what is 2 plus 2?"), fetch grid, run through the production extractor
and Slack formatter, sanity-check that the answer contains "4". Exit 0 = healthy.

```bash
cd ~/projects/claude-code-slack-bot
npx tsx scripts/healthcheck-webterm-claude.ts          # API + claude only
npx tsx scripts/healthcheck-webterm-claude.ts --ui     # also probe Vite UI on 5173
```

All thresholds and the prompt itself are overridable via env vars
(`HEALTHCHECK_PROMPT`, `HEALTHCHECK_EXPECT`, `BOOT_TIMEOUT_MS`,
`TURN_TIMEOUT_MS`, `WEBTERM_CWD`, etc.) — see the header comment in the
script. Typical run takes ~6s on a warm laptop.

If a step fails, the script prints the error AND a hint at what to try
(e.g. "claude might be hitting the trust folder dialog"). Useful before
activating in a real channel, useful after the fact to debug a turn that
came back wrong.

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
