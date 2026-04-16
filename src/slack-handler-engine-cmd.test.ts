import { describe, it, expect } from 'vitest';
import { parseEngineCommand } from './slack-handler';

describe('parseEngineCommand', () => {
  it('returns null for non-command messages', () => {
    expect(parseEngineCommand('what time is it')).toBeNull();
    expect(parseEngineCommand('use copilot')).toBeNull(); // no prefix
    expect(parseEngineCommand('')).toBeNull();
  });

  it('parses use-copilot', () => {
    expect(parseEngineCommand('command: use copilot')).toBe('use-copilot');
    expect(parseEngineCommand('Command: use copilot')).toBe('use-copilot');
    expect(parseEngineCommand('COMMAND: use copilot')).toBe('use-copilot');
  });

  it('parses use-claude', () => {
    expect(parseEngineCommand('command: use claude')).toBe('use-claude');
  });

  it('parses engine?', () => {
    expect(parseEngineCommand('command: engine?')).toBe('engine?');
  });

  it('returns unknown for unrecognized verbs', () => {
    expect(parseEngineCommand('command: use gpt')).toBe('unknown');
    expect(parseEngineCommand('command:')).toBe('unknown');
    expect(parseEngineCommand('command: ')).toBe('unknown');
  });
});
