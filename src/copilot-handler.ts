import { spawn } from 'child_process';

const DEFAULT_COPILOT_EXECUTABLE = '/Users/dustincheng/.local/bin/copilot';

/**
 * Parses JSONL output from `copilot --output-format json` and extracts
 * the assistant's text response.
 *
 * The Copilot CLI emits one JSON object per line. The text response appears
 * in `assistant.message` events at `data.content` (a plain string).
 * Multiple `assistant.message` events are concatenated in order.
 *
 * Other events (session.*, user.message, assistant.message_delta, result, etc.)
 * are metadata/progress and are ignored for text extraction.
 */
export function extractTextFromLines(lines: string[]): string {
  const parts: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Skip unparseable lines (e.g. noise/colour codes in text mode)
      continue;
    }

    if (obj.type === 'assistant.message') {
      const data = obj.data as Record<string, unknown> | undefined;
      if (data && typeof data.content === 'string' && data.content.length > 0) {
        parts.push(data.content);
      }
    }
  }

  return parts.join('');
}

export class CopilotHandler {
  query(prompt: string, abortController?: AbortController): Promise<string> {
    const executable = process.env.COPILOT_EXECUTABLE ?? DEFAULT_COPILOT_EXECUTABLE;
    const args = ['-p', prompt, '--yolo', '--output-format', 'json', '--no-auto-update'];

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const proc = spawn(executable, args, { env: process.env });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      proc.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        reject(new Error(`Failed to spawn Copilot CLI: ${err.message}`));
      });

      proc.on('close', (exitCode: number | null) => {
        if (settled) return;
        settled = true;

        // If already aborted, the abort handler already rejected
        if (abortController?.signal.aborted) return;

        if (exitCode !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
          reject(new Error(`Copilot CLI failed (exit ${exitCode}): ${stderr}`));
          return;
        }

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const lines = stdout.split('\n');
        const text = extractTextFromLines(lines);

        if (!text) {
          reject(new Error('Copilot returned an empty response'));
          return;
        }

        resolve(text);
      });

      if (abortController) {
        abortController.signal.addEventListener('abort', () => {
          if (settled) return;
          settled = true;
          proc.kill('SIGTERM');
          reject(new Error('Copilot query aborted'));
        });
      }
    });
  }
}
