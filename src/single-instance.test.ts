import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess, execSync } from 'child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findOtherInstances, ensureSingleInstance, DEFAULT_PATTERN } from './single-instance';

describe('DEFAULT_PATTERN — matches the bot, not sibling tsx scripts', () => {
	const bot = [
		'node dist/index.js',
		'node /Users/x/projects/claude-code-slack-bot/dist/index.js',
		'node --require .../tsx/dist/preflight.cjs --import file:///.../tsx/dist/loader.mjs src/index.ts',
		'node .../node_modules/.bin/tsx watch src/index.ts',
	];
	const notBot = [
		// claw-a9zo: the ai-digest job runner is tsx-loaded in the bot's cwd but
		// is NOT the always-on bot — it must not trip the single-instance guard.
		'npm exec tsx scripts/run-via-webterm.ts --job ai-digest --prompt-file /x/ai-digest.md --timeout-ms 1800000',
		'node --require .../tsx/dist/preflight.cjs --import file:///.../tsx/dist/loader.mjs scripts/run-via-webterm.ts --job ai-digest',
		'node .../tsx/dist/loader.mjs scripts/healthcheck-webterm-claude.ts',
	];
	for (const cmd of bot) {
		it(`flags: ${cmd.slice(0, 50)}`, () => expect(DEFAULT_PATTERN.test(cmd)).toBe(true));
	}
	for (const cmd of notBot) {
		it(`ignores: ${cmd.slice(0, 50)}`, () => expect(DEFAULT_PATTERN.test(cmd)).toBe(false));
	}
});

let testDir: string;
let testTag: string;
let testPattern: RegExp;
const childProcs: ChildProcess[] = [];

beforeEach(() => {
	testTag = `sitest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	testDir = join(tmpdir(), testTag);
	mkdirSync(testDir, { recursive: true });
	process.env.SLACK_BOT_LOCK_DIR = testDir;
	// Don't pollute the real claudeclaw/logs/slack-bot-YYYY-MM-DD.log
	// with test-spawned bot startup chatter.
	process.env.SLACK_BOT_LOG_DIR = 'off';
	delete process.env.SLACK_BOT_FORCE_TAKEOVER;
	// A pattern unique to this test run — keeps tests isolated from any real
	// bot instance running on the machine.
	testPattern = new RegExp(`${testTag}-fakebot`);
});

afterEach(() => {
	for (const child of childProcs) {
		try {
			if (child.pid) process.kill(child.pid, 'SIGKILL');
		} catch {
			/* ignore */
		}
	}
	childProcs.length = 0;
	rmSync(testDir, { recursive: true, force: true });
	delete process.env.SLACK_BOT_LOCK_DIR;
	delete process.env.SLACK_BOT_LOG_DIR;
	delete process.env.SLACK_BOT_FORCE_TAKEOVER;
});

/**
 * Spawns a long-running `node` process whose argv includes the unique test
 * tag, so the per-test pattern matches it but not any real bot on the host.
 */
function spawnFakeBot(): ChildProcess {
	const scriptPath = join(testDir, `${testTag}-fakebot.js`);
	writeFileSync(scriptPath, `setTimeout(() => {}, 60000);`);

	const child = spawn(process.execPath, [scriptPath], {
		stdio: 'ignore',
		detached: false,
	});
	childProcs.push(child);

	const deadline = Date.now() + 2000;
	while (Date.now() < deadline) {
		try {
			execSync(`ps -p ${child.pid} -o pid=`, { stdio: 'pipe' });
			break;
		} catch {
			execSync('sleep 0.05');
		}
	}
	return child;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Wait for `child` to emit 'exit'. Resolves true if it exits in time. */
function waitForExit(child: ChildProcess, timeoutMs = 3000): Promise<boolean> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return Promise.resolve(true);
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		child.once('exit', () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

describe('findOtherInstances', () => {
	it('returns empty when no matching processes are running', () => {
		const others = findOtherInstances(testPattern, null);
		expect(others).toEqual([]);
	});

	it('detects a spawned fake bot process', () => {
		const fake = spawnFakeBot();
		const others = findOtherInstances(testPattern, null);
		const found = others.find((o) => o.pid === fake.pid);
		expect(found, `expected to find pid ${fake.pid} in: ${JSON.stringify(others)}`).toBeDefined();
	});

	it('excludes the current process even if it matches the pattern', () => {
		// Match anything — should still exclude us via ancestry.
		const matchEverything = /node|deno|bun|tsx|vitest|sleep/;
		const others = findOtherInstances(matchEverything);
		expect(others.find((o) => o.pid === process.pid)).toBeUndefined();
	});
});

describe('ensureSingleInstance', () => {
	it('writes a lock file when no other instances exist', () => {
		ensureSingleInstance({ pattern: testPattern, cwdContains: null });
		const lockPath = join(testDir, 'slack-bot.lock');
		expect(existsSync(lockPath)).toBe(true);
		expect(readFileSync(lockPath, 'utf-8').trim()).toBe(String(process.pid));
	});

	it('throws a clear error when another instance is detected', () => {
		spawnFakeBot();
		expect(() => ensureSingleInstance({ pattern: testPattern, cwdContains: null })).toThrow(
			/another slack-bot instance is already running/,
		);
	});

	it('terminates the prior instance when force=true', async () => {
		const fake = spawnFakeBot();
		expect(isAlive(fake.pid!)).toBe(true);
		ensureSingleInstance({ force: true, pattern: testPattern, cwdContains: null });
		expect(await waitForExit(fake)).toBe(true);
	});

	it('honours SLACK_BOT_FORCE_TAKEOVER=1 env var', async () => {
		const fake = spawnFakeBot();
		process.env.SLACK_BOT_FORCE_TAKEOVER = '1';
		expect(() => ensureSingleInstance({ pattern: testPattern, cwdContains: null })).not.toThrow();
		expect(await waitForExit(fake)).toBe(true);
	});
});

describe('graceful shutdown coexistence (claw-wb4a)', () => {
	// ensureSingleInstance() runs at startup, BEFORE index.ts registers its
	// gracefulShutdown SIGTERM handler. If ensureSingleInstance installs its own
	// `SIGTERM -> process.exit(0)` listener, that listener (registered first)
	// fires first on a launchd `kickstart -k` and force-exits the process before
	// gracefulShutdown can drain in-flight webterm turns — silently dropping the
	// reply (Slack already acked the event, so it never redelivers). The lock
	// file must still be cleaned up, but via `process.on('exit')`, NOT a
	// signal handler that preempts graceful shutdown.
	it('does not preempt a later-registered SIGTERM handler that drains async', async () => {
		const markerPath = join(testDir, 'drained.marker');
		const modPath = join(__dirname, 'single-instance.ts');
		// The fixture path carries the unique tag so ensureSingleInstance's own
		// scan matches only this process (excluded as self) — no false conflict.
		const fixturePath = join(testDir, `${testTag}-fakebot-graceful.ts`);
		writeFileSync(
			fixturePath,
			[
				`const { ensureSingleInstance } = require(${JSON.stringify(modPath)});`,
				`const fs = require('fs');`,
				`ensureSingleInstance({ pattern: new RegExp(${JSON.stringify(testTag)}), cwdContains: null });`,
				// gracefulShutdown registered AFTER ensureSingleInstance — exactly
				// the order index.ts uses. It drains asynchronously (the marker is
				// written 50ms later), so a preempting process.exit(0) would beat it.
				`process.on('SIGTERM', () => { setTimeout(() => { fs.writeFileSync(${JSON.stringify(markerPath)}, 'drained'); process.exit(0); }, 50); });`,
				`setInterval(() => {}, 1000);`,
				`console.log('READY');`,
			].join('\n'),
		);
		const child = spawn(process.execPath, ['-r', 'tsx/cjs', fixturePath], {
			stdio: ['ignore', 'pipe', 'ignore'],
			env: { ...process.env, SLACK_BOT_LOCK_DIR: testDir, SLACK_BOT_LOG_DIR: 'off' },
		});
		childProcs.push(child);
		await waitForStdout(child, 'READY', 8000);

		process.kill(child.pid!, 'SIGTERM');

		// The graceful handler must have run to completion (marker written);
		// ensureSingleInstance must not have force-exited first.
		expect(await waitForFile(markerPath, 3000)).toBe(true);
	});
});

/** Wait for `child` to print `needle` on stdout. Rejects on timeout. */
function waitForStdout(child: ChildProcess, needle: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`child never printed "${needle}"`)), timeoutMs);
		child.stdout?.on('data', (d: Buffer) => {
			if (d.toString().includes(needle)) {
				clearTimeout(timer);
				resolve();
			}
		});
	});
}

/** Poll for `path` to exist. Resolves true if it appears in time. */
async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(path)) return true;
		await new Promise((r) => setTimeout(r, 25));
	}
	return false;
}
