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

- `select_image` (image-gen MCP) → upload selected image
- Write/edit with image extension → upload the file
- Bash output containing image paths → upload detected files
- Cap: 10 images per tool invocation
- `generate_images` previews are skipped — only the final selection uploads

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
├── config.ts                # Environment config
├── slack-handler.ts         # Event handling, streaming, tool filtering
├── claude-handler.ts        # Claude Code SDK integration
├── session-id.ts            # UUID v5 thread→session mapping
├── thread-lock.ts           # Per-thread mutex
├── image-uploader.ts        # Image detection + Slack upload
├── working-directory-manager.ts
├── file-handler.ts          # Uploaded file processing
├── mcp-manager.ts           # MCP server lifecycle
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

## Usage

**In channels**: Mention the bot — `@YourBot help me refactor this function`

**In DMs**: Just message directly.

**In threads**: Every reply in a thread continues the same Claude session. Context carries across messages. This is the main interaction model — start a thread, have a multi-turn conversation, come back to it later.

**Working directory**: `cwd <path>` to set or override. `cwd` alone to check current.

**File uploads**: Drag and drop files into the conversation. Text files are embedded in the prompt, images are passed for Claude to analyze.

**MCP tools**: Available automatically. `mcp` to list configured servers, `mcp reload` to pick up config changes.

## Customization Ideas

This is a personal deployment bot — it's designed to be forked and customized. Some things you might want to add:

- **System prompt injection**: Append context per-channel (e.g., discourse mode for discussion channels, ops mode for incident channels)
- **Memory integration**: Nudge Claude to save context before sessions end (see `appendSystemPrompt` in `claude-handler.ts`)
- **Circuit breaker**: If you run multiple bots in the same workspace, add cascade detection to prevent error-loop feedback between bots
- **Image generation**: Wire up an image-gen MCP server and the bot auto-uploads results to threads

## Attribution

Built on the foundation of [mpociot/claude-code-slack-bot](https://github.com/mpociot/claude-code-slack-bot) by Marcel Pociot. The original project provided the Slack Bolt + Claude Code SDK wiring that this implementation extends.

## License

MIT
