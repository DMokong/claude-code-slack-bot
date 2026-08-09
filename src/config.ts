import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

dotenv.config();

// The webterm API requires a bearer token (claw-yv02). Resolve it the same way
// every local client does: WEBTERM_TOKEN env, else the shared token file the
// server writes on boot. Empty string if neither exists (auth-off / pre-boot).
function resolveWebtermToken(): string {
  const env = process.env.WEBTERM_TOKEN?.trim();
  if (env) return env;
  try {
    const file = process.env.WEBTERM_TOKEN_FILE || join(homedir(), '.webterm', 'token');
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  } catch {
    return '';
  }
}

function parseChannelFileRoutes(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function loadChannelMap(filePath?: string): Record<string, string> {
  if (!filePath) return {};
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.warn(`[config] Could not load CHANNEL_MAP_PATH (${filePath}):`, e);
  }
  return {};
}

export const config = {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN!,
    appToken: process.env.SLACK_APP_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  claude: {
    useBedrock: process.env.CLAUDE_CODE_USE_BEDROCK === '1',
    useVertex: process.env.CLAUDE_CODE_USE_VERTEX === '1',
    // Latest generation only — sonnet or opus, never haiku (Dustin, 2026-08-09).
    model: process.env.CLAUDE_MODEL || 'claude-opus-5',
  },
  streaming: {
    mode: (process.env.SLACK_STREAMING_MODE || 'native') as 'native' | 'legacy' | 'off',
    bufferSize: parseInt(process.env.SLACK_STREAM_BUFFER_SIZE || '128', 10),
  },
  channelFileRoutes: parseChannelFileRoutes(process.env.CHANNEL_FILE_ROUTES || '{}'),
  channelNames: loadChannelMap(process.env.CHANNEL_MAP_PATH),
  baseDirectory: process.env.BASE_DIRECTORY || '',
  defaultWorkingDirectory: process.env.DEFAULT_WORKING_DIRECTORY || '',
  debug: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',
  // Webterm-driven claude runtime (claw-op2n Phase 2 demoable integration).
  // Set WEBTERM_CHANNELS=C0XXX,C0YYY to route specific Slack channels through
  // a persistent interactive `claude` process hosted in webterm instead of
  // the `claude -p` SDK path. Empty list (default) = no channels routed,
  // existing behavior unchanged.
  webterm: {
    channels: (process.env.WEBTERM_CHANNELS || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    // Route ALL messages through the webterm runtime (vs the per-channel
    // allowlist above). Use when migrating off the headless `claude -p` SDK
    // path entirely. Falls back to the SDK path only for messages with file
    // attachments (the webterm handler doesn't process files yet — that's
    // claw-o05f / file-routing follow-ups).
    routeAll: process.env.WEBTERM_ROUTE_ALL === '1' || process.env.WEBTERM_ROUTE_ALL === 'true',
    url: process.env.WEBTERM_URL || 'http://127.0.0.1:7681',
    cwd: process.env.WEBTERM_CWD || `${process.env.HOME}/projects/claudeclaw`,
    // --permission-mode auto, not the blanket bypass (Dustin, 2026-08-09).
    claudeCmd: process.env.WEBTERM_CLAUDE_CMD || 'claude --permission-mode auto',
    // Direct-spawn argv (claw-3btg.1): whitespace-separated, argv[0] must be
    // an ABSOLUTE path on the webterm server's WEBTERM_SPAWN_ALLOWLIST, e.g.
    // WEBTERM_DIRECT_SPAWN_CMD="/Users/me/.local/bin/claude --permission-mode auto".
    // Unset = legacy mode (type claudeCmd into the session shell).
    directSpawnCmd: (process.env.WEBTERM_DIRECT_SPAWN_CMD || '')
      .split(/\s+/)
      .filter((s) => s.length > 0),
    token: resolveWebtermToken(),
    // Live-activity status streaming (claw-1ta5) — on by default; set
    // WEBTERM_STREAM_STATUS=0 to disable and post a single final message.
    streamStatus: process.env.WEBTERM_STREAM_STATUS !== '0' && process.env.WEBTERM_STREAM_STATUS !== 'false',
  },
};

export function validateConfig() {
  const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'SLACK_SIGNING_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}