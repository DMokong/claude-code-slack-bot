# claw-akpn spike: webterm-driven interactive claude

Throwaway bridge that drives a long-lived `claude` REPL inside a webterm session and
relays output to either stdin (smoke test) or a single Slack thread (live test).

**Don't merge this branch.** Single-thread, single-session, in-memory state, no error
recovery. Delete when phase 2 starts.

## Run it (stdin mode — for solo smoke testing)

```bash
# terminal 1: start webterm
cd ~/projects/webterm
pnpm --filter @webterm/server dev

# terminal 2: drive it
cd ~/projects/claude-code-slack-bot
node spike/bridge.mjs
# you'll see "> " — type prompts, get replies
```

## Run it (slack mode — real thread)

Pick a thread the production bot is NOT subscribed to (a thread in a channel without
the bot, or a fresh test channel). Get the channel ID and the parent message ts.

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_CHANNEL=C0XXXXXX
export SLACK_THREAD_TS=1716000000.000100
export MODE=slack
node spike/bridge.mjs
```

The script polls the thread every 2.5s for new user messages and posts replies as the
bot. It runs forever until you Ctrl-C.

## What it does

1. Creates a webterm session (120x40).
2. Sends `claude\n` as input; waits for the first SSE `idle` event = REPL ready.
3. Loop: receives a user turn → sends text + Enter → accumulates `output-chunk`
   bytes → on next `idle`, post-processes (strip ANSI, trim, collapse blank lines)
   → emits the assistant turn.
4. On Ctrl-C, kills the webterm session.

## Env vars

| Var | Default | Note |
|---|---|---|
| `WEBTERM_URL` | `http://127.0.0.1:7681` | webterm server base |
| `IDLE_MS` | `1500` | SSE idle window (ms after last output → idle fires) |
| `CLAUDE_CMD` | `claude` | command to launch in the session |
| `COLS` / `ROWS` | `120` / `40` | terminal dims |
| `MODE` | `stdin` | or `slack` |
| `SLACK_BOT_TOKEN` | — | required in slack mode |
| `SLACK_CHANNEL` | — | channel id (Cxxx or Dxxx) |
| `SLACK_THREAD_TS` | — | parent message ts |
| `SLACK_POLL_MS` | `2500` | poll interval |

## Deliverable

The point of this spike isn't the code — it's the learnings memo at
`~/projects/claudeclaw/docs/plans/2026-05-29-webterm-claude-spike-learnings.md`.
