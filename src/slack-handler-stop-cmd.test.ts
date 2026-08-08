import { describe, it, expect } from 'vitest';
import { isStopCommand } from './slack-handler';

describe('isStopCommand', () => {
  it('recognizes stop/abort/esc case-insensitively, with surrounding whitespace', () => {
    expect(isStopCommand('stop')).toBe(true);
    expect(isStopCommand('Stop')).toBe(true);
    expect(isStopCommand('ABORT')).toBe(true);
    expect(isStopCommand('esc')).toBe(true);
    expect(isStopCommand('  stop  ')).toBe(true);
  });

  it('rejects text that is not exactly a stop command', () => {
    expect(isStopCommand('stop it')).toBe(false);
    expect(isStopCommand('please stop')).toBe(false);
    expect(isStopCommand('')).toBe(false);
    expect(isStopCommand('hello')).toBe(false);
  });

  // claw-uu2u A3: files-only messages carry text: undefined — the guard that
  // admits them into the webterm routing block no longer requires text, so
  // this check must not crash on `.trim()` of undefined.
  it('does not crash on undefined text and reports false', () => {
    expect(() => isStopCommand(undefined)).not.toThrow();
    expect(isStopCommand(undefined)).toBe(false);
  });
});
