import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// claw-3t2q: channel-routed "permanent" files must survive cleanupTempFiles.
// Root cause was downloadFile() populating tempPath (the "delete me later"
// marker) even when targetDir routed the file to its permanent destination —
// so the unconditional cleanupTempFiles() at the end of every message wiped
// files the channel route had just "saved".

vi.mock('node-fetch', () => ({
  default: vi.fn(async () => ({
    ok: true,
    buffer: async () => Buffer.from('file-content'),
  })),
}));

import { FileHandler } from './file-handler';

function slackFile(name: string) {
  return {
    name,
    size: 123,
    mimetype: 'text/plain',
    url_private_download: `https://files.slack.example/${name}`,
  };
}

describe('FileHandler channel-routed vs temp files (claw-3t2q)', () => {
  let handler: FileHandler;
  let routeDir: string;

  beforeEach(() => {
    handler = new FileHandler();
    routeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-route-'));
  });

  afterEach(() => {
    fs.rmSync(routeDir, { recursive: true, force: true });
  });

  it('routes files to targetDir without marking them as temp', async () => {
    const [processed] = await handler.downloadAndProcessFiles([slackFile('report.txt')], {
      targetDir: routeDir,
    });

    expect(processed.path.startsWith(routeDir)).toBe(true);
    expect(fs.existsSync(processed.path)).toBe(true);
    // A routed file is a delivery, not scratch space — nothing to clean up.
    expect(processed.tempPath).toBeUndefined();
  });

  it('channel-routed files survive cleanupTempFiles', async () => {
    const processed = await handler.downloadAndProcessFiles([slackFile('keep-me.txt')], {
      targetDir: routeDir,
    });

    await handler.cleanupTempFiles(processed);

    expect(fs.existsSync(processed[0].path)).toBe(true);
  });

  it('un-routed downloads still land in the OS temp dir and are cleaned up', async () => {
    const processed = await handler.downloadAndProcessFiles([slackFile('scratch.txt')]);

    expect(processed[0].tempPath).toBeDefined();
    expect(processed[0].path.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(processed[0].path)).toBe(true);

    await handler.cleanupTempFiles(processed);

    expect(fs.existsSync(processed[0].path)).toBe(false);
  });
});
