import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getThreadEntry,
  setEngine,
  setClaudeSessionId,
  getClaudeSessionId,
  hasExplicitThreadState,
} from './thread-state-manager';

let testCwd: string;

beforeEach(() => {
  testCwd = join(tmpdir(), `tsmtest-${Date.now()}`);
  mkdirSync(join(testCwd, 'config'), { recursive: true });
});

afterEach(() => {
  rmSync(testCwd, { recursive: true, force: true });
});

function statePath() {
  return join(testCwd, 'config', 'thread-state.json');
}

describe('getThreadEntry', () => {
  it('returns default entry when file does not exist', () => {
    const entry = getThreadEntry('uuid-1', testCwd);
    expect(entry).toEqual({ claude: null, copilot: null, engine: 'claude', setBy: 'global-default' });
  });

  it('returns existing entry from file', () => {
    const state = {
      'uuid-1': { claude: 'sdk-abc', copilot: null, engine: 'copilot', setBy: 'manual' },
    };
    writeFileSync(statePath(), JSON.stringify(state));
    const entry = getThreadEntry('uuid-1', testCwd);
    expect(entry.engine).toBe('copilot');
    expect(entry.claude).toBe('sdk-abc');
  });

  it('migrates flat string entries on read', () => {
    writeFileSync(statePath(), JSON.stringify({ 'uuid-1': 'sdk-old' }));
    const entry = getThreadEntry('uuid-1', testCwd);
    expect(entry.claude).toBe('sdk-old');
    expect(entry.engine).toBe('claude');
    expect(entry.setBy).toBe('global-default');
    // Verify it was written back in new format
    const written = JSON.parse(readFileSync(statePath(), 'utf-8'));
    expect(typeof written['uuid-1']).toBe('object');
  });
});

describe('hasExplicitThreadState', () => {
  it('returns false when no entry exists', () => {
    expect(hasExplicitThreadState('uuid-1', testCwd)).toBe(false);
  });

  it('returns true when entry exists', () => {
    setEngine('uuid-1', testCwd, 'claude', 'manual');
    expect(hasExplicitThreadState('uuid-1', testCwd)).toBe(true);
  });
});

describe('setEngine', () => {
  it('creates new entry when none exists', () => {
    setEngine('uuid-1', testCwd, 'copilot', 'manual');
    const entry = getThreadEntry('uuid-1', testCwd);
    expect(entry.engine).toBe('copilot');
    expect(entry.setBy).toBe('manual');
    expect(entry.claude).toBe(null);
  });

  it('preserves existing claude session when switching engine', () => {
    setClaudeSessionId('uuid-1', testCwd, 'sdk-abc');
    setEngine('uuid-1', testCwd, 'copilot', 'auto-fallback');
    const entry = getThreadEntry('uuid-1', testCwd);
    expect(entry.engine).toBe('copilot');
    expect(entry.claude).toBe('sdk-abc');
    expect(entry.setBy).toBe('auto-fallback');
  });
});

describe('setClaudeSessionId / getClaudeSessionId', () => {
  it('saves and retrieves claude session ID', () => {
    setClaudeSessionId('uuid-1', testCwd, 'sdk-xyz');
    expect(getClaudeSessionId('uuid-1', testCwd)).toBe('sdk-xyz');
  });

  it('preserves engine when saving session ID', () => {
    setEngine('uuid-1', testCwd, 'copilot', 'manual');
    setClaudeSessionId('uuid-1', testCwd, 'sdk-xyz');
    const entry = getThreadEntry('uuid-1', testCwd);
    expect(entry.engine).toBe('copilot');
    expect(entry.claude).toBe('sdk-xyz');
  });

  it('returns null for unknown threadId', () => {
    expect(getClaudeSessionId('no-such-uuid', testCwd)).toBe(null);
  });
});

describe('legacy migration', () => {
  it('does not crash if legacy file is absent', () => {
    expect(() => getThreadEntry('uuid-1', testCwd)).not.toThrow();
  });
});
