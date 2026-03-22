import { WebClient } from '@slack/web-api';
import { Logger } from './logger';

export class SlackStreamManager {
  private activeStream: any = null; // ChatStreamer from @slack/web-api
  private streamFailed = false;
  private fallbackText = '';
  private logger = new Logger('SlackStreamManager');

  constructor(
    private client: WebClient,
    private channel: string,
    private threadTs: string,
    private recipientUserId?: string,
    private recipientTeamId?: string,
    private bufferSize = 128,
  ) {}

  /** Append text to the current stream (starts one if needed) */
  async append(text: string): Promise<void> {
    if (!text) return;

    if (this.streamFailed) {
      this.fallbackText += text;
      return;
    }

    try {
      if (!this.activeStream) {
        const streamParams: any = {
          channel: this.channel,
          thread_ts: this.threadTs,
          buffer_size: this.bufferSize,
        };
        // recipient_user_id and recipient_team_id are required for channel messages, not DMs
        if (this.recipientUserId) {
          streamParams.recipient_user_id = this.recipientUserId;
        }
        if (this.recipientTeamId) {
          streamParams.recipient_team_id = this.recipientTeamId;
        }
        this.activeStream = (this.client as any).chatStream(streamParams);
        this.logger.debug('Started new Slack stream', { channel: this.channel, threadTs: this.threadTs });
      }
      await this.activeStream.append({ markdown_text: text });
    } catch (error) {
      this.logger.warn('Slack stream failed, switching to fallback mode', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.streamFailed = true;
      this.fallbackText += text;
    }
  }

  /** Stop the current stream (finalizes the message) */
  async stop(blocks?: any[]): Promise<void> {
    if (this.activeStream) {
      try {
        await this.activeStream.stop(blocks ? { blocks } : undefined);
        this.logger.debug('Stopped Slack stream');
      } catch (error) {
        this.logger.debug('Stream stop failed (may already be stopped)', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.activeStream = null;
    }
  }

  /** Reset for a new text segment (after tool use interruption) */
  reset(): void {
    this.activeStream = null;
    // Don't reset streamFailed — once failed, stay in fallback for the rest of this message
  }

  get failed(): boolean {
    return this.streamFailed;
  }

  get pendingFallbackText(): string {
    return this.fallbackText;
  }

  consumeFallbackText(): string {
    const text = this.fallbackText;
    this.fallbackText = '';
    return text;
  }

  /** Whether a stream is currently active */
  get isStreaming(): boolean {
    return this.activeStream !== null;
  }
}
