export interface ConversationSession {
  userId: string;
  channelId: string;
  threadTs?: string;
  sessionId?: string;
  isActive: boolean;
  lastActivity: Date;
  workingDirectory?: string;
}

export interface WorkingDirectoryConfig {
  channelId: string;
  threadTs?: string;
  userId?: string;
  directory: string;
  setAt: Date;
}

export type EngineMode = 'claude' | 'copilot';
export type EngineSetBy = 'manual' | 'auto-fallback' | 'channel-default' | 'global-default';

export interface ThreadStateEntry {
  claude: string | null;      // SDK-assigned session ID; null if Claude never used in this thread
  copilot: null;              // Copilot sessions are ephemeral — always null
  engine: EngineMode;
  setBy: EngineSetBy;
}