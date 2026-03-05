import { v5 as uuidv5 } from 'uuid';

/**
 * ClaudeClaw namespace UUID for session ID generation.
 * Generated via: uuidv5('claudeclaw.slack.sessions', DNS_NAMESPACE)
 */
export const CLAUDECLAW_NAMESPACE = '886a9017-602b-53e5-8248-a8b3ca9a047c';

/**
 * Converts a Slack thread_ts into a deterministic UUID v5 session ID.
 * The same thread_ts always produces the same session ID, enabling
 * Claude Code's `--session-id` flag to resume conversations per-thread.
 */
export function threadToSessionId(threadTs: string): string {
  return uuidv5(threadTs, CLAUDECLAW_NAMESPACE);
}
