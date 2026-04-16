import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Logger } from './logger';
import { ThreadStateEntry, EngineMode, EngineSetBy } from './types';

const logger = new Logger('ThreadStateManager');

type ThreadStateMap = Record<string, ThreadStateEntry>;
type RawStateMap = Record<string, ThreadStateEntry | string>;

// Track which cwds have already had legacy migration checked (per process)
const legacyMigrationChecked = new Set<string>();

/**
 * Returns the path to the thread-state JSON file for the given working directory.
 */
export function getStatePath(cwd: string): string {
  return join(cwd, 'config', 'thread-state.json');
}

/**
 * Applies the same cwd sanitization Claude Code uses for project directories.
 * Used to locate the legacy thread-session-map.json file.
 */
export function sanitizeCwd(cwd: string): string {
  return cwd.replace(/^\//, '').replace(/\//g, '-').replace(/^/, '-');
}

/**
 * Converts any flat string entries (legacy format) in a raw state map to
 * proper ThreadStateEntry objects. Returns the converted map and whether
 * any migration occurred.
 */
export function migrateRawEntries(raw: RawStateMap): [ThreadStateMap, boolean] {
  const result: ThreadStateMap = {};
  let didMigrate = false;

  for (const [threadId, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      // Legacy flat string format: "uuid": "sessionId"
      result[threadId] = {
        claude: value,
        copilot: null,
        engine: 'claude',
        setBy: 'global-default',
      };
      didMigrate = true;
      logger.debug('Migrated legacy flat entry', { threadId, sessionId: value });
    } else {
      result[threadId] = value;
    }
  }

  return [result, didMigrate];
}

/**
 * Loads thread state from disk for the given working directory.
 * Handles:
 * - Missing file (returns empty map)
 * - Legacy flat string entries (migrates in-place)
 * - Legacy ~/.claude/projects/{sanitized-cwd}/thread-session-map.json (first call per cwd)
 */
export function loadState(cwd: string): ThreadStateMap {
  const statePath = getStatePath(cwd);
  let state: ThreadStateMap = {};
  let shouldSave = false;

  // Load current state file if it exists
  if (existsSync(statePath)) {
    try {
      const raw = JSON.parse(readFileSync(statePath, 'utf-8')) as RawStateMap;
      const [migrated, didMigrate] = migrateRawEntries(raw);
      state = migrated;
      if (didMigrate) {
        shouldSave = true;
      }
    } catch (err) {
      logger.error('Failed to parse thread-state.json, starting fresh', err);
      state = {};
    }
  }

  // Check for legacy file on first call per cwd (once per process)
  if (!legacyMigrationChecked.has(cwd)) {
    legacyMigrationChecked.add(cwd);

    const sanitized = sanitizeCwd(cwd);
    const legacyPath = join(homedir(), '.claude', 'projects', sanitized, 'thread-session-map.json');

    if (existsSync(legacyPath)) {
      logger.info('Found legacy thread-session-map.json, migrating', { legacyPath });
      try {
        const legacyRaw = JSON.parse(readFileSync(legacyPath, 'utf-8')) as Record<string, string>;

        // Merge entries not already in the new state
        let mergedAny = false;
        for (const [threadId, sessionId] of Object.entries(legacyRaw)) {
          if (!(threadId in state)) {
            state[threadId] = {
              claude: sessionId,
              copilot: null,
              engine: 'claude',
              setBy: 'global-default',
            };
            mergedAny = true;
          }
        }

        if (mergedAny) {
          shouldSave = true;
        }

        // Rename legacy file to mark it as migrated
        const migratedPath = legacyPath + '.migrated';
        renameSync(legacyPath, migratedPath);
        logger.info('Legacy file migrated and renamed', { migratedPath });
      } catch (err) {
        logger.error('Failed to migrate legacy thread-session-map.json', err);
      }
    }
  }

  if (shouldSave) {
    saveState(cwd, state);
  }

  return state;
}

/**
 * Writes thread state to disk. Creates the config directory if needed.
 */
export function saveState(cwd: string, state: ThreadStateMap): void {
  const statePath = getStatePath(cwd);
  const tmpPath = statePath + '.tmp';
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, statePath);
  logger.debug('Saved thread state', { statePath, threadCount: Object.keys(state).length });
}

const DEFAULT_ENTRY: ThreadStateEntry = {
  claude: null,
  copilot: null,
  engine: 'claude',
  setBy: 'global-default',
};

/**
 * Returns the ThreadStateEntry for the given thread ID, or a default entry if not found.
 */
export function getThreadEntry(threadId: string, cwd: string): ThreadStateEntry {
  const state = loadState(cwd);
  return state[threadId] ?? { ...DEFAULT_ENTRY };
}

/**
 * Returns true if the given thread ID has an entry in the state file.
 */
export function hasExplicitThreadState(threadId: string, cwd: string): boolean {
  const state = loadState(cwd);
  return threadId in state;
}

/**
 * Sets the engine mode for a thread, preserving all other fields.
 */
export function setEngine(threadId: string, cwd: string, engine: EngineMode, setBy: EngineSetBy): void {
  const state = loadState(cwd);
  const existing = state[threadId] ?? { ...DEFAULT_ENTRY };
  state[threadId] = {
    ...existing,
    engine,
    setBy,
  };
  saveState(cwd, state);
  logger.debug('Engine set', { threadId, engine, setBy });
}

/**
 * Sets the Claude SDK session ID for a thread, preserving all other fields.
 */
export function setClaudeSessionId(threadId: string, cwd: string, sdkSessionId: string): void {
  const state = loadState(cwd);
  const existing = state[threadId] ?? { ...DEFAULT_ENTRY };
  state[threadId] = {
    ...existing,
    claude: sdkSessionId,
  };
  saveState(cwd, state);
  logger.debug('Claude session ID set', { threadId, sdkSessionId });
}

/**
 * Returns the Claude SDK session ID for the given thread, or null if not set.
 */
export function getClaudeSessionId(threadId: string, cwd: string): string | null {
  const state = loadState(cwd);
  const entry = state[threadId];
  if (!entry) {
    return null;
  }
  return entry.claude;
}
