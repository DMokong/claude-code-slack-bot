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