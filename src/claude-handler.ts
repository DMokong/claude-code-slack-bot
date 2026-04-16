import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ConversationSession } from './types';
import { Logger } from './logger';
import { McpManager, McpServerConfig } from './mcp-manager';
import { threadToSessionId } from './session-id';
import { getClaudeSessionId, setClaudeSessionId } from './thread-state-manager';

export class ClaudeHandler {
  private sessions: Map<string, ConversationSession> = new Map();
  private logger = new Logger('ClaudeHandler');
  private mcpManager: McpManager;

  constructor(mcpManager: McpManager) {
    this.mcpManager = mcpManager;
  }

  getSessionKey(userId: string, channelId: string, threadTs?: string): string {
    return `${userId}-${channelId}-${threadTs || 'direct'}`;
  }

  getSession(userId: string, channelId: string, threadTs?: string): ConversationSession | undefined {
    return this.sessions.get(this.getSessionKey(userId, channelId, threadTs));
  }

  createSession(userId: string, channelId: string, threadTs?: string): ConversationSession {
    const sessionId = threadTs ? threadToSessionId(threadTs) : undefined;
    const session: ConversationSession = {
      userId,
      channelId,
      threadTs,
      sessionId,
      isActive: true,
      lastActivity: new Date(),
    };
    this.sessions.set(this.getSessionKey(userId, channelId, threadTs), session);
    if (sessionId) {
      this.logger.info('Created session with deterministic ID', { threadTs, sessionId });
    }
    return session;
  }

  /**
   * Get the Claude projects directory for a given cwd.
   * Claude stores sessions at ~/.claude/projects/{sanitized-cwd}/{uuid}.jsonl
   */
  private getProjectDir(cwd: string): string {
    const sanitized = cwd.replace(/^\//, '').replace(/\//g, '-').replace(/^/, '-');
    return join(homedir(), '.claude', 'projects', sanitized);
  }

  /**
   * Resolve a deterministic thread session ID to the actual SDK session ID,
   * checking the mapping file and verifying the session file exists on disk.
   * Returns the SDK session ID if found, undefined otherwise.
   */
  private resolveSessionId(threadSessionId: string, cwd: string): string | undefined {
    // Check mapping file for the real SDK session ID
    const sdkSessionId = getClaudeSessionId(threadSessionId, cwd);
    if (sdkSessionId) {
      const sessionPath = join(this.getProjectDir(cwd), `${sdkSessionId}.jsonl`);
      if (existsSync(sessionPath)) {
        return sdkSessionId;
      }
      this.logger.warn('Mapped session file missing from disk', { threadSessionId, sdkSessionId });
    }
    return undefined;
  }

  async *streamQuery(
    prompt: string,
    session?: ConversationSession,
    abortController?: AbortController,
    workingDirectory?: string,
    slackContext?: { channel: string; threadTs?: string; user: string }
  ): AsyncGenerator<SDKMessage, void, unknown> {
    const options: any = {
      outputFormat: 'stream-json',
      includePartialMessages: true,
      permissionMode: 'bypassPermissions',
      pathToClaudeCodeExecutable: process.env.CLAUDE_EXECUTABLE || 'claude',
      // Prompt-based hooks (SessionEnd, PreCompact) don't fire outside REPL mode.
      // As a workaround, append a system prompt nudge so Claude invokes the remember
      // skill before finishing. See claudeclaw/docs/plans/remember-hook-alternatives.md
      // for future options (SDK programmatic hooks, post-query transcript analysis).
      appendSystemPrompt: [
        slackContext ? `You are responding in Slack channel ID: ${slackContext.channel}${slackContext.threadTs ? ` (thread: ${slackContext.threadTs})` : ''}. Check CLAUDE.md for any channel-specific protocols (e.g., #cc-ai Discourse Protocol).` : '',
        'Before finishing your response, use the remember skill to scan this conversation for any preferences, project context, or relationship continuity worth saving to long-term memory. If nothing is worth saving, skip silently.',
      ].filter(Boolean).join('\n\n'),
    };

    if (workingDirectory) {
      options.cwd = workingDirectory;
    }

    // Add MCP server configuration if available
    const mcpServers = this.mcpManager.getServerConfiguration();
    
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
    }
    
    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      // Allow all MCP tools by default, plus permission prompt tool
      const defaultMcpTools = this.mcpManager.getDefaultAllowedTools();
      if (defaultMcpTools.length > 0) {
        options.allowedTools = defaultMcpTools;
      }
      
      this.logger.debug('Added MCP configuration to options', {
        serverCount: Object.keys(options.mcpServers).length,
        servers: Object.keys(options.mcpServers),
        allowedTools: defaultMcpTools,
      });
    }

    // Determine session strategy: resume existing or create new.
    // The SDK does not support options.sessionId — it always generates its own UUID.
    // We use a mapping file (thread-session-map.json) to translate our deterministic
    // thread-based UUID to the SDK's actual session ID for resume.
    if (session?.sessionId && workingDirectory) {
      const sdkSessionId = this.resolveSessionId(session.sessionId, workingDirectory);
      if (sdkSessionId) {
        options.resume = sdkSessionId;
        this.logger.info('Resuming existing session', {
          threadSessionId: session.sessionId,
          sdkSessionId,
        });
      } else {
        this.logger.info('Creating new session for thread', { threadSessionId: session.sessionId });
      }
    } else {
      this.logger.debug('Starting new Claude conversation (no thread context)');
    }

    this.logger.debug('Claude query options', options);

    try {
      yield* this._executeQuery(prompt, options, session, abortController);
    } catch (error) {
      // R5: If resume fails, fall back to creating a fresh session
      if (options.resume && session?.sessionId) {
        this.logger.warn('Session resume failed, falling back to fresh session', {
          threadSessionId: session.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        delete options.resume;
        yield* this._executeQuery(prompt, options, session, abortController);
      } else {
        throw error;
      }
    }
  }

  private async *_executeQuery(
    prompt: string,
    options: any,
    session?: ConversationSession,
    abortController?: AbortController,
  ): AsyncGenerator<SDKMessage, void, unknown> {
    for await (const message of query({
      prompt,
      abortController: abortController || new AbortController(),
      options,
    } as any)) {
      if (message.type === 'system' && message.subtype === 'init') {
        if (session) {
          const sdkSessionId = message.session_id;
          const threadSessionId = session.sessionId;

          // Persist mapping from deterministic thread ID → SDK session ID
          if (threadSessionId && sdkSessionId !== threadSessionId && options.cwd) {
            setClaudeSessionId(threadSessionId, options.cwd, sdkSessionId);
          }

          this.logger.info('Session initialized', {
            threadSessionId,
            sdkSessionId,
            model: (message as any).model,
            tools: (message as any).tools?.length || 0,
          });
        }
      }
      yield message;
    }
  }

  cleanupInactiveSessions(maxAge: number = 30 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > maxAge) {
        this.sessions.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} inactive sessions`);
    }
  }
}