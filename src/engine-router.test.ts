import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveEngine } from './engine-router';
import { setEngine } from './thread-state-manager';

let testCwd: string;

beforeEach(() => {
  testCwd = join(tmpdir(), `ertest-${Date.now()}`);
  mkdirSync(join(testCwd, 'config'), { recursive: true });
});

afterEach(() => {
  rmSync(testCwd, { recursive: true, force: true });
});

function writeChannelConfig(config: Record<string, string>) {
  writeFileSync(
    join(testCwd, 'config', 'channel-engine.json'),
    JSON.stringify(config),
  );
}

describe('resolveEngine — 3-level hierarchy', () => {
  it('returns global default (claude) when no state exists', () => {
    const result = resolveEngine('uuid-1', 'C0CHANNEL', testCwd);
    expect(result.engine).toBe('claude');
    expect(result.setBy).toBe('global-default');
  });

  it('returns channel default when channel is in channel-engine.json', () => {
    writeChannelConfig({ C0CHANNEL: 'copilot' });
    const result = resolveEngine('uuid-1', 'C0CHANNEL', testCwd);
    expect(result.engine).toBe('copilot');
    expect(result.setBy).toBe('channel-default');
  });

  it('returns global default for channel not in channel-engine.json', () => {
    writeChannelConfig({ C0OTHER: 'copilot' });
    const result = resolveEngine('uuid-1', 'C0CHANNEL', testCwd);
    expect(result.engine).toBe('claude');
    expect(result.setBy).toBe('global-default');
  });

  it('thread state overrides channel default', () => {
    writeChannelConfig({ C0CHANNEL: 'copilot' });
    setEngine('uuid-1', testCwd, 'claude', 'manual');
    const result = resolveEngine('uuid-1', 'C0CHANNEL', testCwd);
    expect(result.engine).toBe('claude');
    expect(result.setBy).toBe('manual');
  });

  it('thread state with auto-fallback is returned', () => {
    setEngine('uuid-1', testCwd, 'copilot', 'auto-fallback');
    const result = resolveEngine('uuid-1', 'C0CHANNEL', testCwd);
    expect(result.engine).toBe('copilot');
    expect(result.setBy).toBe('auto-fallback');
  });

  it('returns global-default when channel-engine.json is malformed', () => {
    writeFileSync(join(testCwd, 'config', 'channel-engine.json'), 'not-json');
    const result = resolveEngine('uuid-1', 'C0CHANNEL', testCwd);
    expect(result.engine).toBe('claude');
    expect(result.setBy).toBe('global-default');
  });
});
