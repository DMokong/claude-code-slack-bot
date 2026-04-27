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
 * Default argv pattern. Matches the entrypoint substring; intentionally broad
 * so it catches every shape the bot can run as:
 *   - `node .../claude-code-slack-bot/dist/index.js`    (prod, npm)
 *   - `node dist/index.js`                              (prod, launchd — argv has no project path)
 *   - `node .../tsx/dist/loader.mjs ... src/index.ts`   (dev / npm start)
 *   - `node .../node_modules/.bin/tsx watch src/index.ts` (npm run dev parent)
 *
 * False-positives (other unrelated `dist/index.js` projects) are filtered
 * out by DEFAULT_CWD_FILTER below.
 */
const DEFAULT_PATTERN = /(?:^|[ /])(?:dist\/index\.js|src\/index\.ts)(?:\s|$)|tsx watch src\/index\.ts|tsx\/dist\/loader\.mjs/;

/**
 * Default cwd filter. A candidate process must have `claude-code-slack-bot`
 * somewhere in its working directory to count as a bot. This is what
 * disambiguates the launchd-mode `node dist/index.js` (no project path in
 * argv) from any other project's `node dist/index.js`.
 */
const DEFAULT_CWD_FILTER = 'claude-code-slack-bot';

export interface RunningInstance {
	pid: number;
	cmd: string;
	cwd?: string;
}

/** Returns the cwd of `pid` via lsof, or null if unavailable. */
function getCwd(pid: number): string | null {
	try {
		// `lsof -a -p PID -d cwd -Fn` outputs lines starting with 'p<pid>' and 'n<path>'.
		const out = execSync(`/usr/sbin/lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, {
			encoding: 'utf-8',
			timeout: 2000,
		});
		const m = out.match(/^n(.+)$/m);
		return m ? m[1] : null;
	} catch {
		return null;
	}
}

/**
 * Returns the immediate ancestry of `pid` — self, parent, grandparent,
 * great-grandparent. Capped at depth 4 because the legitimate "do not
 * flag this as another instance" chain is at most:
 *
 *     us  ←  tsx  ←  npm  ←  shell
 *
 * Walking all the way to init causes false-negatives when this code runs
 * inside a subprocess of the supervised bot itself (e.g. a `claude`
 * subprocess spawned by the bot to handle a Slack message). In that
 * scenario, the bot would be many ancestors up — but we WANT to flag it
 * as another instance, so it must NOT end up in the exclusion set.
 */
function getAncestry(pid: number, depth = 3): Set<number> {
	const ancestry = new Set<number>();
	let current = pid;
	let remaining = depth;
	while (current > 1 && remaining > 0 && !ancestry.has(current)) {
		ancestry.add(current);
		remaining--;
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
 * the bot's argv pattern AND has `cwdContains` in its working directory,
 * minus this process's own ancestry (so a `tsx watch` parent of ours is
 * not flagged as "another instance").
 *
 * Uses `ps -axo pid=,command=` because `pgrep -a` is GNU-only and doesn't
 * exist on macOS. Uses `lsof -d cwd` to read each candidate's cwd.
 *
 * Pass `cwdContains: null` to skip the cwd filter (used by tests).
 */
export function findOtherInstances(
	pattern: RegExp = DEFAULT_PATTERN,
	cwdContains: string | null = DEFAULT_CWD_FILTER,
): RunningInstance[] {
	let out: string;
	try {
		out = execSync(`ps -axo pid=,command=`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
	} catch (err: any) {
		logger.warn('ps failed; skipping single-instance check', { error: err?.message });
		return [];
	}

	const ours = getAncestry(process.pid);

	const argvMatches: RunningInstance[] = out
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
		// Require the process to actually be a node/tsx invocation (or a
		// node-like binary). This filters out shells that happen to mention
		// the entrypoint as a string in their command line — common when
		// the user runs `zsh -c "npx tsx src/index.ts"` from a terminal.
		.filter((p) => /(?:^|\/)(?:node|tsx|bun|deno)(?:\s|$)/.test(p.cmd))
		.filter((p) => pattern.test(p.cmd))
		.filter((p) => !ours.has(p.pid));

	if (cwdContains === null) return argvMatches;

	return argvMatches
		.map((p) => ({ ...p, cwd: getCwd(p.pid) ?? undefined }))
		.filter((p) => p.cwd !== undefined && p.cwd.includes(cwdContains));
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
	/** Override the argv pattern used to identify bot processes (testing only). */
	pattern?: RegExp;
	/**
	 * Substring that a candidate process's cwd must contain. Defaults to
	 * `claude-code-slack-bot`. Pass `null` to skip the cwd filter (testing).
	 */
	cwdContains?: string | null;
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
	const cwdFilter = options.cwdContains === undefined ? DEFAULT_CWD_FILTER : options.cwdContains;
	const others = findOtherInstances(options.pattern, cwdFilter);

	if (others.length > 0) {
		const list = others
			.map((o) => `  PID ${o.pid}: ${o.cmd}${o.cwd ? `  (cwd: ${o.cwd})` : ''}`)
			.join('\n');

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
