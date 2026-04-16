import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setClaudeSessionId, getClaudeSessionId } from './thread-state-manager';

let testCwd: string;

beforeEach(() => {
  testCwd = join(tmpdir(), `chtest-${Date.now()}`);
  mkdirSync(join(testCwd, 'config'), { recursive: true });
});

afterEach(() => {
  rmSync(testCwd, { recursive: true, force: true });
});

describe('ThreadStateManager session persistence (used by ClaudeHandler)', () => {
  it('setClaudeSessionId writes to thread-state.json', () => {
    setClaudeSessionId('thread-uuid-1', testCwd, 'sdk-session-abc');
    const state = JSON.parse(readFileSync(join(testCwd, 'config', 'thread-state.json'), 'utf-8'));
    expect(state['thread-uuid-1'].claude).toBe('sdk-session-abc');
  });

  it('getClaudeSessionId reads what was written', () => {
    setClaudeSessionId('thread-uuid-1', testCwd, 'sdk-session-abc');
    expect(getClaudeSessionId('thread-uuid-1', testCwd)).toBe('sdk-session-abc');
  });
});
