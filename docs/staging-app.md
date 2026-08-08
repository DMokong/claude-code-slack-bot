# Staging Slack App (claw-0dlt)

A second Slack app so spike/staging bot builds don't collide with the
production bot (whose `app.message` handler fires on every plain message in
any channel it's a member of).

## What Dustin needs to do (workspace admin, ~5 min)

1. https://api.slack.com/apps → **Create New App → From a manifest** → pick the
   Mokong Tech workspace → paste `docs/staging-app-manifest.yml`.
2. **Socket Mode** → generate an app-level token with `connections:write` →
   this is `SLACK_APP_TOKEN` for staging.
3. **OAuth & Permissions** → install to workspace → copy the bot token
   (`xoxb-…`) → this is `SLACK_BOT_TOKEN` for staging.
4. Create `#cc-staging`, invite `@cindy-staging`.
5. Save both tokens in `.env.staging` (gitignored, template below).

## Running a staging bot

```bash
cd ~/projects/claude-code-slack-bot
set -a; source .env.staging; set +a
WEBTERM_ROUTE_ALL=1 npm run start
```

`src/single-instance.ts` locks per-token, so prod (launchd) and staging (manual)
run side by side.

## .env.staging template

```
SLACK_BOT_TOKEN=xoxb-REPLACE
SLACK_APP_TOKEN=xapp-REPLACE
SLACK_SIGNING_SECRET=REPLACE
WEBTERM_ROUTE_ALL=1
WEBTERM_URL=http://127.0.0.1:7681
```
