import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess, execSync } from 'child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findOtherInstances, ensureSingleInstance } from './single-instance';

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
