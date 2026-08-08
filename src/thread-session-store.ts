// Durable Slack-thread → claude-session-UUID map (claw-m7bj).
//
// The webterm PTY session is disposable (idle-reaped at 30min+), but claude's
// OWN conversation persists as a session file under ~/.claude/projects/. By
// pinning every thread's claude session to a UUID we generate (--session-id)
// and remembering it here, a reaped thread resumes with --resume <uuid> and
// the conversation survives — the 30-minute amnesia fuse defused.
//
// Plain JSON file, loaded on construct, atomically rewritten on every
// mutation (tmp + rename). Volume is Slack-thread-scale: tiny.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export class ThreadSessionStore {
  private map = new Map<string, string>();

  constructor(private filePath: string) {
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, string>;
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string") this.map.set(k, v);
      }
    } catch {
      // Missing or corrupt file = empty store; first mutation recreates it.
    }
  }

  get(threadKey: string): string | undefined {
    return this.map.get(threadKey);
  }

  has(threadKey: string): boolean {
    return this.map.has(threadKey);
  }

  // Mint and persist a fresh UUID for this thread (overwrites any prior one —
  // used both for new threads and for the resume-failed fallback).
  assign(threadKey: string): string {
    const uuid = randomUUID();
    this.map.set(threadKey, uuid);
    this.persist();
    return uuid;
  }

  delete(threadKey: string): void {
    if (this.map.delete(threadKey)) this.persist();
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map), null, 2) + "\n");
      renameSync(tmp, this.filePath);
    } catch {
      // Best-effort: a failed persist degrades to fresh sessions after the
      // next restart, never to a crashed turn.
    }
  }
}
