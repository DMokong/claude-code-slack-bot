import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Logger } from './logger';

const logger = new Logger('SingleInstance');

/**
 * Where to write the lock file. Defaults to the claudeclaw config dir, where
 * the bot already keeps thread-state.json. Override with SLACK_BOT_LOCK_DIR.
 */
function getLockPath(): string {
	const dir = process.env.SLACK_BOT_LOCK_DIR
		?? join(homedir(), 'projects', 'claudeclaw', 'config');
	return join(dir, 'slack-bot.lock');
}

/**
 * Default pattern that matches every shape the bot can run as:
 *   - `node .../claude-code-slack-bot/dist/index.js`    (prod)
 *   - `node .../tsx/dist/loader.mjs ... src/index.ts`   (dev / npm start)
 *   - `node .../node_modules/.bin/tsx watch src/index.ts` (npm run dev parent)
 *
 * All three command lines contain the project directory and end with an
 * `index` reference, so we anchor on the project path plus the entrypoint.
 */
const DEFAULT_PATTERN = /claude-code-slack-bot\/.*(dist\/index\.js|src\/index\.ts)/;

export interface RunningInstance {
	pid: number;
	cmd: string;
}

/** Returns the chain of PIDs from `pid` up to init (PID 1). */
function getAncestry(pid: number): Set<number> {
	const ancestry = new Set<number>();
	let current = pid;
	while (current > 1 && !ancestry.has(current)) {
		ancestry.add(current);
		try {
			const out = execSync(`ps -o ppid= -p ${current}`, { encoding: 'utf-8' }).trim();
			const ppid = parseInt(out, 10);
			if (!ppid || ppid === current) break;
			current = ppid;
		} catch {
			break;
		}
	}
	return ancestry;
}

/**
 * Returns the list of *other* slack-bot processes — anything that matches
 * the bot's command pattern but is not in our own process ancestry (so a
 * `tsx watch` parent of ours is not flagged as "another instance").
 *
 * Uses `ps -axo pid=,command=` because `pgrep -a` is GNU-only and doesn't
 * exist on macOS.
 */
export function findOtherInstances(pattern: RegExp = DEFAULT_PATTERN): RunningInstance[] {
	let out: string;
	try {
		out = execSync(`ps -axo pid=,command=`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
	} catch (err: any) {
		logger.warn('ps failed; skipping single-instance check', { error: err?.message });
		return [];
	}

	const ours = getAncestry(process.pid);

	return out
		.split('\n')
		.map((line) => line.trimStart())
		.filter(Boolean)
		.map((line) => {
			const space = line.indexOf(' ');
			if (space < 0) return null;
			const pid = parseInt(line.slice(0, space), 10);
			const cmd = line.slice(space + 1);
			if (!Number.isFinite(pid)) return null;
			return { pid, cmd } as RunningInstance;
		})
		.filter((p): p is RunningInstance => p !== null)
		.filter((p) => pattern.test(p.cmd))
		.filter((p) => !ours.has(p.pid));
}

/** Best-effort SIGTERM, then SIGKILL after a short wait. */
function killInstance(pid: number): void {
	try {
		process.kill(pid, 'SIGTERM');
	} catch (err: any) {
		if (err?.code !== 'ESRCH') {
			logger.warn('SIGTERM failed', { pid, error: err?.message });
		}
		return;
	}
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return; // process is gone
		}
		// Tiny synchronous spin — we are inside startup, not in an event loop.
		execSync('sleep 0.1');
	}
	try {
		process.kill(pid, 'SIGKILL');
		logger.warn('SIGKILLed unresponsive instance', { pid });
	} catch {
		/* already gone */
	}
}

let cleanupInstalled = false;

function writeLockFile(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, String(process.pid));

	if (cleanupInstalled) return;
	cleanupInstalled = true;

	const remove = () => {
		try {
			if (existsSync(path) && readFileSync(path, 'utf-8').trim() === String(process.pid)) {
				unlinkSync(path);
			}
		} catch {
			/* ignore */
		}
	};
	process.on('exit', remove);
	process.on('SIGTERM', () => process.exit(0));
	process.on('SIGINT', () => process.exit(0));
}

/**
 * Exit code returned when another bot is already running. Distinct from the
 * generic exit-1-on-crash so a supervisor (launchd, etc.) can distinguish
 * "config error, do not relaunch" from "crash, do relaunch".
 */
export const EXIT_CODE_DUPLICATE_INSTANCE = 42;

/** Marker on the thrown Error so callers can detect the duplicate-instance case. */
export const DUPLICATE_INSTANCE_ERROR = 'DuplicateInstanceError';

export interface EnsureOptions {
	/** If true, kill any other instances instead of refusing to start. */
	force?: boolean;
	/** Override the pattern used to identify bot processes (testing only). */
	pattern?: RegExp;
}

/**
 * Throws if another bot is already running. Writes a lock file with our PID
 * on success and registers cleanup handlers.
 *
 * Two layers of defense:
 *   1. ps scan against the bot's command pattern (catches *any* concurrent
 *      bot, including ones we never started ourselves).
 *   2. Lock file at config/slack-bot.lock — diagnostic, not authoritative.
 */
export function ensureSingleInstance(options: EnsureOptions = {}): void {
	const force = options.force ?? process.env.SLACK_BOT_FORCE_TAKEOVER === '1';
	const others = findOtherInstances(options.pattern);

	if (others.length > 0) {
		const list = others.map((o) => `  PID ${o.pid}: ${o.cmd}`).join('\n');

		if (!force) {
			const err = new Error(
				`Refusing to start: another slack-bot instance is already running.\n\n` +
				`Found ${others.length} other process(es):\n${list}\n\n` +
				`Two bots will split-brain Slack events between them and corrupt thread-state.json.\n` +
				`Stop the existing instance first, or set SLACK_BOT_FORCE_TAKEOVER=1 to terminate it.\n`,
			);
			err.name = DUPLICATE_INSTANCE_ERROR;
			throw err;
		}

		logger.warn('Force takeover: terminating prior instances', { count: others.length });
		for (const o of others) {
			killInstance(o.pid);
		}
	}

	const lockPath = getLockPath();
	writeLockFile(lockPath);
	logger.info('Single-instance lock acquired', { pid: process.pid, lockPath });
}
