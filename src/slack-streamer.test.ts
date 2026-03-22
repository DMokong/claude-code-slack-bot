import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackStreamManager } from './slack-streamer';

// Mock ChatStreamer returned by client.chatStream()
function createMockStreamer() {
  return {
    append: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockClient(mockStreamer: ReturnType<typeof createMockStreamer>) {
  return {
    chatStream: vi.fn().mockReturnValue(mockStreamer),
  } as any;
}

describe('SlackStreamManager', () => {
  let mockStreamer: ReturnType<typeof createMockStreamer>;
  let mockClient: any;
  let manager: SlackStreamManager;

  beforeEach(() => {
    mockStreamer = createMockStreamer();
    mockClient = createMockClient(mockStreamer);
    manager = new SlackStreamManager(mockClient, 'C123', '1234.5678', 'U123', 'T123', 128);
  });

  describe('append', () => {
    it('should start a stream on first append', async () => {
      await manager.append('Hello');

      expect(mockClient.chatStream).toHaveBeenCalledWith({
        channel: 'C123',
        thread_ts: '1234.5678',
        buffer_size: 128,
        recipient_user_id: 'U123',
        recipient_team_id: 'T123',
      });
      expect(mockStreamer.append).toHaveBeenCalledWith({ markdown_text: 'Hello' });
    });

    it('should reuse stream on subsequent appends', async () => {
      await manager.append('Hello');
      await manager.append(' world');

      expect(mockClient.chatStream).toHaveBeenCalledTimes(1);
      expect(mockStreamer.append).toHaveBeenCalledTimes(2);
    });

    it('should skip empty text', async () => {
      await manager.append('');
      expect(mockClient.chatStream).not.toHaveBeenCalled();
    });

    it('should not include recipient fields for DMs (when undefined)', async () => {
      const dmManager = new SlackStreamManager(mockClient, 'D123', '1234.5678');
      await dmManager.append('Hello');

      expect(mockClient.chatStream).toHaveBeenCalledWith({
        channel: 'D123',
        thread_ts: '1234.5678',
        buffer_size: 128,
      });
    });
  });

  describe('fallback', () => {
    it('should switch to fallback on stream error', async () => {
      mockStreamer.append.mockRejectedValueOnce(new Error('rate_limited'));

      await manager.append('Hello');
      // First append creates stream, then append fails → fallback
      expect(manager.failed).toBe(true);
      expect(manager.pendingFallbackText).toBe('Hello');
    });

    it('should accumulate text in fallback mode', async () => {
      mockStreamer.append.mockRejectedValueOnce(new Error('fail'));

      await manager.append('Hello');
      await manager.append(' world');

      expect(manager.pendingFallbackText).toBe('Hello world');
    });

    it('should consume fallback text', async () => {
      mockStreamer.append.mockRejectedValueOnce(new Error('fail'));

      await manager.append('Hello');
      const text = manager.consumeFallbackText();

      expect(text).toBe('Hello');
      expect(manager.pendingFallbackText).toBe('');
    });

    it('should switch to fallback if chatStream creation fails', async () => {
      mockClient.chatStream.mockImplementation(() => { throw new Error('not supported'); });

      await manager.append('Hello');

      expect(manager.failed).toBe(true);
      expect(manager.pendingFallbackText).toBe('Hello');
    });
  });

  describe('stop', () => {
    it('should finalize an active stream', async () => {
      await manager.append('Hello');
      await manager.stop();

      expect(mockStreamer.stop).toHaveBeenCalledWith(undefined);
    });

    it('should pass blocks to stop', async () => {
      await manager.append('Hello');
      const blocks = [{ type: 'context', elements: [] }];
      await manager.stop(blocks);

      expect(mockStreamer.stop).toHaveBeenCalledWith({ blocks });
    });

    it('should be a no-op when no stream is active', async () => {
      await manager.stop(); // no error
      expect(mockStreamer.stop).not.toHaveBeenCalled();
    });

    it('should handle stop errors gracefully', async () => {
      await manager.append('Hello');
      mockStreamer.stop.mockRejectedValueOnce(new Error('already stopped'));
      await manager.stop(); // should not throw
    });
  });

  describe('reset', () => {
    it('should allow starting a new stream after reset', async () => {
      await manager.append('First segment');
      await manager.stop();
      manager.reset();
      await manager.append('Second segment');

      expect(mockClient.chatStream).toHaveBeenCalledTimes(2);
    });

    it('should not reset failed state', async () => {
      mockStreamer.append.mockRejectedValueOnce(new Error('fail'));

      await manager.append('Hello');
      manager.reset();
      await manager.append('World');

      expect(manager.failed).toBe(true);
      expect(manager.pendingFallbackText).toBe('HelloWorld');
    });
  });

  describe('isStreaming', () => {
    it('should be false initially', () => {
      expect(manager.isStreaming).toBe(false);
    });

    it('should be true after append', async () => {
      await manager.append('Hello');
      expect(manager.isStreaming).toBe(true);
    });

    it('should be false after stop', async () => {
      await manager.append('Hello');
      await manager.stop();
      expect(manager.isStreaming).toBe(false);
    });
  });
});
