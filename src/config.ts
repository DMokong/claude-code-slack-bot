import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

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
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
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
    url: process.env.WEBTERM_URL || 'http://127.0.0.1:7681',
    cwd: process.env.WEBTERM_CWD || `${process.env.HOME}/projects/claudeclaw`,
    claudeCmd: process.env.WEBTERM_CLAUDE_CMD || 'claude --dangerously-skip-permissions',
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