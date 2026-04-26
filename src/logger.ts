import { config } from './config';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * File-based daily log rotation, invariant of how the bot is launched.
 *
 * Background: the original setup picked a log filename in the start script
 * (`slack-bot-$(date +%Y-%m-%d).log`) at startup time, then redirected
 * stdout/stderr into it. That meant a long-lived bot kept writing to
 * the date its process *started* on — making stale instances invisible
 * because logs from "today" appeared in an old-dated file.
 *
 * The fix lives here so dev-mode (tsx watch), prod (node dist/index.js),
 * and launchd-supervised mode all rotate identically, by date, regardless
 * of process lifetime. A new file appears every day at midnight; a stale
 * instance that hasn't been restarted will still be writing to today's
 * file, making the duplicate-bot case obvious.
 *
 * Disable with SLACK_BOT_LOG_DIR=off if a downstream tool (launchd,
 * the start script's nohup redirect) is already producing dated logs
 * and you'd rather not double-write.
 */
function resolveLogDir(): string | null {
	const env = process.env.SLACK_BOT_LOG_DIR;
	if (env === 'off') return null;
	return env ?? join(homedir(), 'projects', 'claudeclaw', 'logs');
}

let lastEnsuredDir: string | null = null;
let fileLoggingDisabled = false;

function todayKey(): string {
	const d = new Date();
	const yyyy = d.getFullYear().toString().padStart(4, '0');
	const mm = (d.getMonth() + 1).toString().padStart(2, '0');
	const dd = d.getDate().toString().padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

function emitToFile(line: string): void {
	if (fileLoggingDisabled) return;
	const dir = resolveLogDir();
	if (dir === null) return;
	try {
		if (lastEnsuredDir !== dir) {
			mkdirSync(dir, { recursive: true });
			lastEnsuredDir = dir;
		}
		// Sync append: the bot doesn't log densely enough for the syscall
		// cost to matter, and durability beats throughput for an ops log.
		// Every line gets the date computed at write time, so rotation
		// across midnight happens automatically.
		appendFileSync(join(dir, `slack-bot-${todayKey()}.log`), line + '\n');
	} catch (err) {
		fileLoggingDisabled = true;
		// eslint-disable-next-line no-console
		console.warn(`[Logger] file logging disabled: ${(err as Error).message}`);
	}
}

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${this.context}]`;

    if (data) {
      return `${prefix} ${message}\n${JSON.stringify(data, null, 2)}`;
    }
    return `${prefix} ${message}`;
  }

  debug(message: string, data?: any) {
    if (config.debug) {
      const line = this.formatMessage('DEBUG', message, data);
      console.log(line);
      emitToFile(line);
    }
  }

  info(message: string, data?: any) {
    const line = this.formatMessage('INFO', message, data);
    console.log(line);
    emitToFile(line);
  }

  warn(message: string, data?: any) {
    const line = this.formatMessage('WARN', message, data);
    console.warn(line);
    emitToFile(line);
  }

  error(message: string, error?: any) {
    const errorData = error instanceof Error ? {
      errorMessage: error.message,
      stack: error.stack,
      ...error
    } : error;
    const line = this.formatMessage('ERROR', message, errorData);
    console.error(line);
    emitToFile(line);
  }
}
