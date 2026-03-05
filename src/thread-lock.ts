import { Logger } from './logger';

const logger = new Logger('ThreadLock');

/**
 * Per-thread promise-chain mutex.
 *
 * Different threads (different threadTs values) run concurrently.
 * Messages within the same thread are serialized — each waits for
 * the previous one to finish before executing.
 *
 * Implementation: a Map from threadTs to the tail of a promise chain.
 * Each call appends itself to the chain for its thread and cleans up
 * the map entry when no further work is queued.
 */
const locks = new Map<string, Promise<void>>();

/**
 * Execute `fn` while holding the lock for `threadTs`.
 *
 * If another call is already running (or queued) for the same threadTs,
 * this call waits until all prior ones finish before starting.
 *
 * The lock is always released — even if `fn` throws.
 */
export async function withThreadLock<T>(
  threadTs: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Capture whatever is currently at the tail of this thread's chain.
  // If nothing is queued, this resolves immediately.
  const previous = locks.get(threadTs) ?? Promise.resolve();

  // We need a resolve handle we can trigger once fn() completes.
  let releaseLock: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  // Install ourselves as the new tail *synchronously* — before any await —
  // so that any call arriving between now and our first await sees us.
  locks.set(threadTs, current);

  // Wait for the prior holder to finish.
  await previous;

  logger.debug(`Lock acquired for thread ${threadTs}`);

  try {
    const result = await fn();
    return result;
  } finally {
    logger.debug(`Lock released for thread ${threadTs}`);

    // If we are still the tail, nobody else is queued — clean up.
    if (locks.get(threadTs) === current) {
      locks.delete(threadTs);
    }

    // Release so the next waiter (if any) can proceed.
    releaseLock!();
  }
}
