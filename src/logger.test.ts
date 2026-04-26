import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
	testDir = join(tmpdir(), `loggertest-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testDir, { recursive: true });
	process.env.SLACK_BOT_LOG_DIR = testDir;
	// Force a fresh module per test so the cached stream is re-initialised
	// against the new SLACK_BOT_LOG_DIR.
	vi.resetModules();
	consoleSpies.push(vi.spyOn(console, 'log').mockImplementation(() => {}));
	consoleSpies.push(vi.spyOn(console, 'warn').mockImplementation(() => {}));
	consoleSpies.push(vi.spyOn(console, 'error').mockImplementation(() => {}));
});

afterEach(() => {
	for (const spy of consoleSpies) spy.mockRestore();
	consoleSpies.length = 0;
	rmSync(testDir, { recursive: true, force: true });
	delete process.env.SLACK_BOT_LOG_DIR;
	vi.useRealTimers();
});

function todayFilename(date = new Date()): string {
	const y = date.getFullYear();
	const m = (date.getMonth() + 1).toString().padStart(2, '0');
	const d = date.getDate().toString().padStart(2, '0');
	return `slack-bot-${y}-${m}-${d}.log`;
}

describe('Logger', () => {
	it('writes info messages to a date-stamped file in the configured dir', async () => {
		const { Logger } = await import('./logger');
		const log = new Logger('Test');
		log.info('hello world');

		const expected = join(testDir, todayFilename());
		expect(existsSync(expected)).toBe(true);
		const content = readFileSync(expected, 'utf-8');
		expect(content).toMatch(/\[INFO\] \[Test\] hello world/);
	});

	it('rotates to a new file when the date crosses midnight', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 5, 15, 23, 59, 30));

		const { Logger } = await import('./logger');
		const log = new Logger('Rotate');
		log.info('before midnight');

		vi.setSystemTime(new Date(2026, 5, 16, 0, 0, 30));
		log.info('after midnight');

		const before = join(testDir, todayFilename(new Date(2026, 5, 15)));
		const after = join(testDir, todayFilename(new Date(2026, 5, 16)));
		expect(readFileSync(before, 'utf-8')).toMatch(/before midnight/);
		expect(readFileSync(after, 'utf-8')).toMatch(/after midnight/);
		expect(readFileSync(before, 'utf-8')).not.toMatch(/after midnight/);
		expect(readFileSync(after, 'utf-8')).not.toMatch(/before midnight/);
	});

	it('writes warn and error messages to the same dated file', async () => {
		const { Logger } = await import('./logger');
		const log = new Logger('LevelTest');
		log.warn('w');
		log.error('e', new Error('boom'));

		const file = join(testDir, todayFilename());
		const content = readFileSync(file, 'utf-8');
		expect(content).toMatch(/\[WARN\] \[LevelTest\] w/);
		expect(content).toMatch(/\[ERROR\] \[LevelTest\] e/);
		expect(content).toMatch(/boom/);
	});

	it('skips file output when SLACK_BOT_LOG_DIR=off', async () => {
		process.env.SLACK_BOT_LOG_DIR = 'off';
		vi.resetModules();
		const { Logger } = await import('./logger');
		const log = new Logger('Off');
		log.info('should not write');

		const files = readdirSync(testDir);
		expect(files.find((f) => f.startsWith('slack-bot-'))).toBeUndefined();
	});

	it('still writes to console even when file logging is enabled', async () => {
		const { Logger } = await import('./logger');
		const log = new Logger('Console');
		log.info('to console');

		const consoleLog = consoleSpies[0];
		expect(consoleLog).toHaveBeenCalled();
		const calls = (consoleLog.mock.calls as any[]).flat().join('\n');
		expect(calls).toMatch(/to console/);
	});
});
