# Claude Code Slack Bot

A Slack bot that gives Claude Code a persistent, multi-threaded home in your workspace. Each thread becomes a session. Each session gets full tool access, MCP servers, memory, and working directory context. You talk to your agent in Slack the same way you talk to it in the terminal — except threads give you natural session boundaries and the conversation history lives in a place you already check.

Originally scaffolded from [mpociot/claude-code-slack-bot](https://github.com/mpociot/claude-code-slack-bot). Since then, the session model, image handling, concurrency, and overall architecture have been substantially rewritten.

## What Makes This Different

### Thread = Session (Deterministic, Resumable)

Every Slack thread maps to a Claude Code session via deterministic UUID v5. Same thread always produces the same session ID — no database, no in-memory maps that die on restart. Follow-up messages in a thread automatically `--resume` the prior session. First message creates, subsequent messages continue.

```
Thread ts: 1774057353.775109
    ↓ UUID v5 (ClaudeClaw namespace)
Session ID: a8b3ca9a-047c-5... (deterministic, reproducible)
    ↓
claude --resume <session-id> -p "your message"
```

This means your agent remembers what it was doing across bot restarts, deploys, even machine reboots. The session state lives in Claude Code's own persistence layer.

### Per-Thread Concurrency

Messages within the same thread are serialized via a promise-chain mutex — no two Claude invocations fight over the same session. Different threads run fully concurrent. This is important when you have multiple conversations going or when teammates are using the bot simultaneously.

### Image Upload Pipeline

When Claude generates or writes images (via MCP tools, file writes, or bash output), the bot detects them and uploads directly to the Slack thread using `files.uploadV2`. Images render inline — no public URLs, no external hosting.

- `generate_images` (image-gen MCP) → upload all previews to the thread so you can review and select
- `select_image` → upload the final selected image
- Write/edit with image extension → upload the file
- Bash output containing image paths → upload detected files
- Cap: 10 images per tool invocation

### Noise Reduction

The upstream bot posts every tool use to the thread. That's a lot of noise when Claude is doing 30+ tool calls to research a question. This fork filters:

- **Shown**: Write, Edit, NotebookEdit (mutations you care about)
- **Silent**: Read, Grep, Glob, Bash, Agent (research noise)
- **Status messages**: Deleted on success, preserved on error

### Working Directory = Claude Project Context

This is more important than it sounds. `BASE_DIRECTORY` + `DEFAULT_WORKING_DIRECTORY` determine where Claude Code launches — which means it inherits the full Claude project configuration from that directory:

- **CLAUDE.md** — system prompt, personality, conventions, protocols
- **`.claude/settings.json`** — permissions, allowed tools, plugin configuration
- **`.claude/plugins/`** — custom skills, hooks, memory systems
- **MCP servers** — any project-scoped MCP config
- **`.claude/rules/`** — always-loaded behavioral rules

If you've invested in customizing your Claude Code project setup — personality, memory, plugins, MCP servers, permission policies — the Slack bot inherits all of it. The agent in Slack is the same agent you get in the terminal, with the same context and capabilities. Threads can override with `cwd <path>` for cross-project work.

```
Thread-specific > Channel default > DEFAULT_WORKING_DIRECTORY
```

## Architecture

```
src/
├── index.ts                 # Entry point
├── config.ts                # Environment config + channel file routes
├── slack-handler.ts         # Event handling, streaming, tool filtering
├── slack-streamer.ts        # Native Slack streaming (chat.startStream API)
├── claude-handler.ts        # Claude Code SDK integration
├── session-id.ts            # UUID v5 thread→session mapping
├── thread-lock.ts           # Per-thread mutex
├── image-uploader.ts        # Image detection + Slack upload
├── image-handler.ts         # Image processing utilities
├── working-directory-manager.ts
├── file-handler.ts          # Uploaded file processing + channel routing
├── mcp-manager.ts           # MCP server lifecycle
├── permission-mcp-server.ts # Permission prompt MCP server
├── todo-manager.ts          # Task list rendering
├── logger.ts                # Structured logging
└── types.ts
```

### Key Design Decisions

1. **Native binary, not SDK bundled CLI**: The `@anthropic-ai/claude-code` SDK's bundled `cli.js` crashes on Node v25.6+. The bot uses `pathToClaudeCodeExecutable` pointing to the system-installed `claude` binary as a workaround.

2. **`bypassPermissions` mode**: Appropriate for a personal/trusted workspace where you control both the bot and the Slack workspace. Not suitable for shared/public deployments without additional guardrails.

3. **Deterministic session IDs over in-memory maps**: Stateless by design. The bot can crash, restart, and reconnect to existing sessions without any persistence layer of its own.

4. **Emoji shortcode conversion**: Slack's reaction API rejects Unicode emoji — the bot maps 🤔→`thinking_face`, ✅→`white_check_mark`, etc. before calling `reactions.add`.

## Setup

### Prerequisites

- Node.js 18+
- Claude Code installed (`claude` binary on PATH)
- Claude authentication (`claude login` — works with Max subscription, API key, Bedrock, or Vertex)
- A Slack workspace you control

### 1. Clone and Install

```bash
git clone https://github.com/DMokong/claude-code-slack-bot.git
cd claude-code-slack-bot
npm install
```

### 2. Create Slack App

Use the included manifest for quick setup:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → "Create New App" → "From an app manifest"
2. Paste the contents of `slack-app-manifest.yaml`
3. Install to your workspace

Required scopes: `app_mentions:read`, `channels:history`, `chat:write`, `im:history`, `users:read`, `reactions:write`, `files:write`

Socket Mode must be enabled (the manifest handles this).

### 3. Configure Environment

```bash
cp .env.example .env
```

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...

# Optional but recommended
BASE_DIRECTORY=/Users/you/projects/
DEFAULT_WORKING_DIRECTORY=your-main-project

# Channel file routing (optional)
# Maps Slack channel IDs to local directories.
# Files uploaded in a mapped channel are saved to that directory instead of temp.
CHANNEL_FILE_ROUTES={"C0ABC123":"/path/to/save/files","C0DEF456":"/another/path"}
```

### 4. Configure MCP Servers (Optional)

```bash
cp mcp-servers.example.json mcp-servers.json
```

Add any MCP servers you want available to Claude during Slack sessions. Example:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]
    }
  }
}
```

### 5. Run

```bash
npm run dev     # Development (hot reload via tsx watch)
npm run build && npm run prod   # Production
```

## Operational Modes

There are two ways to run the bot. Pick one — the single-instance check (below) prevents you from accidentally running both at once.

### Mode A — Dev (`tsx watch`)

```bash
~/projects/claudeclaw/scripts/start-slack-bot.sh start          # start
~/projects/claudeclaw/scripts/start-slack-bot.sh status         # check
~/projects/claudeclaw/scripts/start-slack-bot.sh restart        # restart
~/projects/claudeclaw/scripts/start-slack-bot.sh stop           # stop
~/projects/claudeclaw/scripts/start-slack-bot.sh tail           # follow today's log
~/projects/claudeclaw/scripts/start-slack-bot.sh logs [N]       # last N lines
```

- **Hot reload** — `tsx watch` re-execs the bot whenever `src/*.ts` changes. Save → ~1s → bot is back with the new code.
- Runs source directly. No build step.
- Dies if you close the terminal that started it (it backgrounds via `nohup` so usually OK), if you reboot, or if you `stop`.
- Best for: actively iterating on bot code.

### Mode B — Launchd (supervised)

```bash
~/projects/claudeclaw/scripts/slack-bot-launchd-install.sh install   # install + start
~/projects/claudeclaw/scripts/slack-bot-launchd-install.sh status    # check
~/projects/claudeclaw/scripts/slack-bot-launchd-install.sh stop      # bootout (plist stays)
~/projects/claudeclaw/scripts/slack-bot-launchd-install.sh install   # to bounce / pick up changes
```

- **Supervised by macOS launchd**. Survives reboots. `KeepAlive=Crashed` auto-relaunches on crash with a 30s throttle. `ProcessType=Interactive` prevents App Nap so Slack stays responsive.
- Runs compiled `dist/index.js`. NOT auto-reloaded. To pick up new code, see *"Updating the launchd-supervised bot"* below.
- Won't crash-loop on operator error: when the single-instance check fires (exit 42), the wrapper translates it to clean exit 0 and launchd leaves it alone.
- Best for: "Cindy is always there" — production posture.

### When to use which

| Use case | Mode |
|---|---|
| Editing `src/*.ts` and want changes immediately | **Dev** (hot reload) |
| Want the bot to survive your laptop sleeping/rebooting | **Launchd** |
| Iterating on slack-handler / claude-handler logic | **Dev** |
| Day-to-day "is Cindy reachable in Slack" | **Launchd** |
| Stress-testing the supervisor / KeepAlive behaviour | **Launchd** |

### Updating the launchd-supervised bot

The launchd bot runs `node dist/index.js` from the *built* output. To pick up new code:

```bash
# One-liner: bootout, re-symlink plist, bootstrap. The wrapper auto-rebuilds
# dist/ on startup if src/ is newer than dist/.
~/projects/claudeclaw/scripts/slack-bot-launchd-install.sh install
```

Or, if you want the build to run *before* the bounce (so you see compile errors immediately):

```bash
cd ~/projects/claude-code-slack-bot && npm run build
~/projects/claudeclaw/scripts/slack-bot-launchd-install.sh install
```

| You changed… | Dev bot | Launchd bot |
|---|---|---|
| `src/*.ts` | auto-restart, ~1s | reinstall (auto-rebuilds dist) |
| `mcp-servers.json` / `.env` / `.env.otel` | restart bot | reinstall |
| `config/launchd/com.claudeclaw.slack-bot.plist` | n/a | reinstall (re-bootstrap reads new plist) |
| `scripts/launchd-slack-bot.sh` | n/a | reinstall |

The launchd-side wrapper (`scripts/launchd-slack-bot.sh`) silently swallows build failures so a stray TypeScript typo can't take the bot offline indefinitely. If you suspect a stale build:

```bash
tail -20 ~/projects/claudeclaw/logs/slack-bot-launchd.log    # check for "build failed"
cd ~/projects/claude-code-slack-bot && npm run build          # see the actual error
```

### Logging

The bot's logger writes every line both to the console and to `slack-bot-YYYY-MM-DD.log` in the log directory. The date is recomputed per write, so a long-lived process rotates automatically across midnight — a stale instance left running for days will keep writing to *today's* file, making the duplicate-bot case easy to spot.

```
SLACK_BOT_LOG_DIR=/path   # Override log directory (default: ~/projects/claudeclaw/logs)
SLACK_BOT_LOG_DIR=off     # Disable file logging (console only — useful in tests)
```

**Three log files exist; one is the canonical operational log:**

| File | What's in it | When to read |
|---|---|---|
| `slack-bot-YYYY-MM-DD.log` | Bot's own logger output (every INFO/WARN/ERROR via `Logger`). Rotates daily at midnight, automatically, regardless of how the bot was launched. | **Default — read this 99% of the time.** |
| `slack-bot-launcher.log` | Wrapper output from `start-slack-bot.sh` (OTel init, `npm start`, build output in `--prod`). Single file, not rotated. | When dev bot fails to *start* and nothing shows up in the dated log. |
| `slack-bot-launchd.log` | launchd-side stdout/stderr — pre-init crashes, things that escape Node, the wrapper's own echoes. Single file. | Only relevant in launchd mode, only when something is very wrong. |

The dev-mode `start-slack-bot.sh` has `tail` and `logs [N]` subcommands that target the dated file. From any mode you can also just:

```bash
tail -f ~/projects/claudeclaw/logs/slack-bot-$(date +%Y-%m-%d).log
```

`tail` follows the file live (Ctrl-C to stop); `logs N` prints the last N lines and exits.

### Single-Instance Enforcement

The bot refuses to start if another bot process is already running on the same machine. Two bots on the same Slack token split-brain events between them and corrupt `config/thread-state.json` (which maps Slack threads → Claude session IDs).

On startup, `ensureSingleInstance()`:

1. Runs `ps -axo pid=,command=` and filters by an argv pattern that catches every shape the bot can run as: prod `node dist/index.js` (no project path), dev `node ... src/index.ts`, `tsx watch`, npm wrappers.
2. For each match, reads the process's working directory via `lsof -d cwd` and keeps only those whose cwd contains `claude-code-slack-bot`. This is what disambiguates the launchd-mode bare `node dist/index.js` from any other project's `node dist/index.js`.
3. Excludes the current process's *immediate* ancestry (depth 3 — covers `npm → tsx → node` legitimately, but does NOT walk all the way to init, which would falsely swallow the bot itself when this code runs inside a subprocess of the bot — e.g. a `claude` subprocess spawned to handle a Slack message).
4. If any matches remain, throws `DuplicateInstanceError` and exits 42.

```
SLACK_BOT_FORCE_TAKEOVER=1   # SIGTERM prior instances and take over
SLACK_BOT_LOCK_DIR=/path     # Override lock-file location (default: ~/projects/claudeclaw/config/)
```

The lock file at `<lock-dir>/slack-bot.lock` holds the running bot's PID and is removed on graceful shutdown. **Exit code 42 is special** — the launchd wrapper translates it to a clean exit 0 so the duplicate-instance condition (operator error, not a crash) does not trigger `KeepAlive` crash-loop relaunches.

## Usage

**In channels**: Mention the bot — `@YourBot help me refactor this function`

**In DMs**: Just message directly.

**In threads**: Every reply in a thread continues the same Claude session. Context carries across messages. This is the main interaction model — start a thread, have a multi-turn conversation, come back to it later.

**Working directory**: `cwd <path>` to set or override. `cwd` alone to check current.

**File uploads**: Drag and drop files into the conversation. Text files are embedded in the prompt, images are passed for Claude to analyze.

**MCP tools**: Available automatically. `mcp` to list configured servers, `mcp reload` to pick up config changes.

## Customization Ideas

This is a personal deployment bot — it's designed to be forked and customized. The following have all been implemented in my own setup outside this repo. If you're interested in seeing how any of these work in practice, feel free to reach out.

- **System prompt injection**: Append context per-channel (e.g., discourse mode for discussion channels, ops mode for incident channels)
- **Memory integration**: Nudge Claude to save context before sessions end (see `appendSystemPrompt` in `claude-handler.ts`)
- **Circuit breaker**: If you run multiple bots in the same workspace, add cascade detection to prevent error-loop feedback between bots
- **Image generation**: Wire up an image-gen MCP server and the bot auto-uploads results to threads

## Attribution

Built on the foundation of [mpociot/claude-code-slack-bot](https://github.com/mpociot/claude-code-slack-bot) by Marcel Pociot. The original project provided the Slack Bolt + Claude Code SDK wiring that this implementation extends.

## License

MIT
