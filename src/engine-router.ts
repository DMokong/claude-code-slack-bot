import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { EngineMode, EngineSetBy } from './types';
import { hasExplicitThreadState, getThreadEntry } from './thread-state-manager';
import { Logger } from './logger';

const logger = new Logger('EngineRouter');

export interface EngineResolution {
  engine: EngineMode;
  setBy: EngineSetBy;
}

/**
 * Resolve which engine to use for a thread.
 * Resolution order: thread state → channel default → global default (Claude).
 */
export function resolveEngine(
  threadId: string,
  channelId: string,
  cwd: string,
): EngineResolution {
  // Level 1: explicit thread state
  if (hasExplicitThreadState(threadId, cwd)) {
    const entry = getThreadEntry(threadId, cwd);
    return { engine: entry.engine, setBy: entry.setBy };
  }

  // Level 2: channel default from channel-engine.json
  const channelDefault = getChannelDefault(channelId, cwd);
  if (channelDefault) {
    return { engine: channelDefault, setBy: 'channel-default' };
  }

  // Level 3: global default
  return { engine: 'claude', setBy: 'global-default' };
}

function getChannelDefault(channelId: string, cwd: string): EngineMode | null {
  const path = join(cwd, 'config', 'channel-engine.json');
  if (!existsSync(path)) return null;
  try {
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    const value = config[channelId];
    if (value === 'copilot' || value === 'claude') return value;
    return null;
  } catch (err) {
    logger.warn('Failed to read channel-engine.json', { error: String(err) });
    return null;
  }
}
