import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopilotHandler } from './copilot-handler';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = vi.mocked(spawn);

function makeMockProcess(stdoutLines: string[], exitCode: number = 0, stderrLines: string[] = []) {
  const stdout = new EventEmitter() as any;
  const stderr = new EventEmitter() as any;
  const proc = new EventEmitter() as any;
  proc.stdout = stdout;
  proc.stderr = stderr;

  setImmediate(() => {
    for (const line of stdoutLines) {
      stdout.emit('data', Buffer.from(line + '\n'));
    }
    stdout.emit('end');
    for (const line of stderrLines) {
      stderr.emit('data', Buffer.from(line + '\n'));
    }
    proc.emit('close', exitCode);
  });

  return proc;
}

describe('CopilotHandler.query', () => {
  let handler: CopilotHandler;

  beforeEach(() => {
    handler = new CopilotHandler();
    vi.clearAllMocks();
  });

  it('extracts text from JSONL response', async () => {
    // Actual Copilot CLI --output-format json JSONL format observed:
    // - session.* events for setup metadata (ephemeral)
    // - user.message event
    // - assistant.turn_start event
    // - assistant.reasoning_delta events (ephemeral, can ignore)
    // - assistant.message_delta event (ephemeral streaming delta)
    // - assistant.message event — data.content is the full text response (plain string)
    // - assistant.turn_end event
    // - result event with exitCode and usage summary
    const jsonlLines = [
      JSON.stringify({ type: 'session.start', data: { sessionId: 'abc', version: 1, producer: 'test', copilotVersion: '1.0.28', startTime: '2026-04-16T10:00:00Z' }, id: '1', timestamp: '2026-04-16T10:00:00Z', parentId: null }),
      JSON.stringify({ type: 'user.message', data: { content: 'What is 2+2?', transformedContent: 'What is 2+2?', attachments: [] }, id: '2', timestamp: '2026-04-16T10:00:01Z', parentId: '1' }),
      JSON.stringify({ type: 'assistant.turn_start', data: { turnId: '0' }, id: '3', timestamp: '2026-04-16T10:00:02Z', parentId: '1' }),
      JSON.stringify({ type: 'assistant.message_delta', data: { messageId: 'msg-1', deltaContent: 'hello' }, id: '4', timestamp: '2026-04-16T10:00:03Z', parentId: '3', ephemeral: true }),
      JSON.stringify({ type: 'assistant.message', data: { messageId: 'msg-1', content: 'hello', toolRequests: [] }, id: '5', timestamp: '2026-04-16T10:00:03Z', parentId: '3' }),
      JSON.stringify({ type: 'assistant.turn_end', data: { turnId: '0' }, id: '6', timestamp: '2026-04-16T10:00:03Z', parentId: '5' }),
      JSON.stringify({ type: 'result', timestamp: '2026-04-16T10:00:03Z', sessionId: 'abc', exitCode: 0, usage: { premiumRequests: 0.33 } }),
    ];
    mockSpawn.mockReturnValue(makeMockProcess(jsonlLines, 0) as any);
    const result = await handler.query('What is 2+2?');
    expect(result).toContain('hello');
  });

  it('throws on non-zero exit code', async () => {
    mockSpawn.mockReturnValue(makeMockProcess([], 1, ['Authentication failed']) as any);
    await expect(handler.query('hello')).rejects.toThrow(/Copilot/i);
  });

  it('throws on empty response', async () => {
    mockSpawn.mockReturnValue(makeMockProcess([], 0) as any);
    await expect(handler.query('hello')).rejects.toThrow(/empty/i);
  });

  it('respects abort signal', async () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    // Don't emit close — we're testing the abort path
    mockSpawn.mockReturnValue(proc as any);

    const controller = new AbortController();
    const queryPromise = handler.query('hello', controller);
    controller.abort();
    await expect(queryPromise).rejects.toThrow(/abort/i);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('throws on spawn failure', async () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    mockSpawn.mockReturnValue(proc as any);

    const queryPromise = handler.query('hello');
    proc.emit('error', new Error('ENOENT: no such file or directory'));
    await expect(queryPromise).rejects.toThrow(/Failed to spawn Copilot CLI/i);
  });

  it('uses COPILOT_EXECUTABLE env var when set', async () => {
    process.env.COPILOT_EXECUTABLE = '/custom/path/copilot';
    try {
      const jsonlLines = [
        JSON.stringify({ type: 'assistant.message', data: { messageId: 'msg-1', content: 'hello', toolRequests: [] }, id: '5', timestamp: '2026-04-16T10:00:03Z', parentId: '3' }),
      ];
      mockSpawn.mockReturnValue(makeMockProcess(jsonlLines, 0) as any);
      await handler.query('hello');
      expect(mockSpawn).toHaveBeenCalledWith(
        '/custom/path/copilot',
        expect.any(Array),
        expect.any(Object),
      );
    } finally {
      delete process.env.COPILOT_EXECUTABLE;
    }
  });

  it('concatenates content from multiple assistant.message events', async () => {
    const jsonlLines = [
      JSON.stringify({ type: 'assistant.message', data: { messageId: 'msg-1', content: 'First part. ', toolRequests: [] }, id: '1', timestamp: '2026-04-16T10:00:01Z', parentId: null }),
      JSON.stringify({ type: 'assistant.message', data: { messageId: 'msg-2', content: 'Second part.', toolRequests: [] }, id: '2', timestamp: '2026-04-16T10:00:02Z', parentId: null }),
    ];
    mockSpawn.mockReturnValue(makeMockProcess(jsonlLines, 0) as any);
    const result = await handler.query('hello');
    expect(result).toContain('First part.');
    expect(result).toContain('Second part.');
  });
});
