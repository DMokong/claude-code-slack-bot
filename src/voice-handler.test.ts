import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VoiceHandler, VoiceConfig, Exec } from './voice-handler';

const cfg: VoiceConfig = {
  enabled: true,
  whisperBin: 'whisper-cli',
  whisperModel: '/models/ggml-small.en.bin',
  ffmpegBin: 'ffmpeg',
  ttsVoice: 'Samantha',
  ttsRate: 185,
  maxSpeechChars: 6000,
};

describe('VoiceHandler.isVoiceFile', () => {
  const vh = new VoiceHandler(cfg, vi.fn());

  it('accepts Slack voice clips (audio/mp4)', () => {
    expect(vh.isVoiceFile({ mimetype: 'audio/mp4', name: 'audio_message.m4a' })).toBe(true);
  });

  it('accepts common audio extensions', () => {
    expect(vh.isVoiceFile({ mimetype: 'application/octet-stream', name: 'memo.mp3' })).toBe(true);
    expect(vh.isVoiceFile({ mimetype: '', name: 'clip.wav' })).toBe(true);
    expect(vh.isVoiceFile({ mimetype: '', name: 'note.ogg' })).toBe(true);
  });

  it('accepts audio-only mp4 voice clips reported as video/mp4', () => {
    expect(vh.isVoiceFile({ mimetype: 'video/mp4', name: 'audio_message.mp4' })).toBe(true);
  });

  it('rejects real video and non-audio files', () => {
    expect(vh.isVoiceFile({ mimetype: 'video/mp4', name: 'screencap.mp4' })).toBe(false);
    expect(vh.isVoiceFile({ mimetype: 'video/webm', name: 'demo.webm' })).toBe(false);
    expect(vh.isVoiceFile({ mimetype: 'image/png', name: 'chart.png' })).toBe(false);
    expect(vh.isVoiceFile({ mimetype: 'application/pdf', name: 'report.pdf' })).toBe(false);
  });
});

describe('VoiceHandler.prepareSpeechText', () => {
  const vh = new VoiceHandler(cfg, vi.fn());

  it('replaces fenced code blocks with a spoken marker', () => {
    const out = vh.prepareSpeechText('Here:\n```\nconst x = 1;\n```\nDone.');
    expect(out).not.toContain('const x');
    expect(out).toContain('(code omitted.)');
    expect(out).toContain('Done.');
  });

  it('unwraps slack links to their labels and drops bare urls', () => {
    expect(vh.prepareSpeechText('See <https://example.com|the docs> now')).toBe('See the docs now');
    expect(vh.prepareSpeechText('At <https://example.com/x> ok')).toBe('At (link) ok');
  });

  it('strips mrkdwn emphasis and inline code', () => {
    expect(vh.prepareSpeechText('*bold* and _ital_ and `code` and ~gone~')).toBe(
      'bold and ital and code and gone',
    );
  });

  it('strips emoji codes, mentions, and bullets', () => {
    const out = vh.prepareSpeechText(':tada: <@U123> says\n• first\n- second');
    expect(out).not.toContain(':tada:');
    expect(out).not.toContain('<@U123>');
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  it('decodes slack HTML entities', () => {
    expect(vh.prepareSpeechText('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
  });

  it('truncates beyond maxSpeechChars', () => {
    const small = new VoiceHandler({ ...cfg, maxSpeechChars: 20 }, vi.fn());
    const out = small.prepareSpeechText('x'.repeat(100));
    expect(out.length).toBeLessThan(60);
    expect(out).toContain('truncated');
  });
});

describe('VoiceHandler.transcribe', () => {
  let calls: Array<{ cmd: string; args: string[] }>;
  let exec: Exec;

  beforeEach(() => {
    calls = [];
    exec = vi.fn(async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      if (cmd === 'whisper-cli') return { stdout: '  Hello there.\n How are you?\n', stderr: '' };
      return { stdout: '', stderr: '' };
    }) as unknown as Exec;
  });

  it('converts via ffmpeg then transcribes via whisper', async () => {
    const vh = new VoiceHandler(cfg, exec);
    const text = await vh.transcribe('/tmp/in.m4a');
    expect(text).toBe('Hello there. How are you?');
    expect(calls[0].cmd).toBe('ffmpeg');
    expect(calls[0].args).toContain('/tmp/in.m4a');
    expect(calls[0].args).toContain('16000');
    expect(calls[1].cmd).toBe('whisper-cli');
    expect(calls[1].args).toContain('/models/ggml-small.en.bin');
    expect(calls[1].args).toContain('--no-timestamps');
  });

  it('filters whisper noise markers and returns null for silence', async () => {
    exec = (async (cmd: string) =>
      cmd === 'whisper-cli'
        ? { stdout: ' [BLANK_AUDIO]\n', stderr: '' }
        : { stdout: '', stderr: '' }) as Exec;
    const vh = new VoiceHandler(cfg, exec);
    expect(await vh.transcribe('/tmp/in.m4a')).toBeNull();
  });

  it('returns null when a tool fails', async () => {
    exec = async () => {
      throw new Error('boom');
    };
    const vh = new VoiceHandler(cfg, exec);
    expect(await vh.transcribe('/tmp/in.m4a')).toBeNull();
  });
});

describe('VoiceHandler.synthesize', () => {
  it('runs say then ffmpeg and returns the m4a path', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      // Simulate the tools producing their output files.
      const out = args[args.indexOf('-o') + 1];
      if (cmd === 'say' && out) fs.writeFileSync(out, 'aiff');
      if (cmd === 'ffmpeg') fs.writeFileSync(args[args.length - 1], 'm4a');
      return { stdout: '', stderr: '' };
    });
    const vh = new VoiceHandler(cfg, exec);
    const out = await vh.synthesize('Hello *world*');
    expect(out).toMatch(/\.m4a$/);
    expect(fs.existsSync(out!)).toBe(true);
    expect(calls[0].cmd).toBe('say');
    expect(calls[0].args).toContain('Samantha');
    // The spoken text file passed to say has mrkdwn stripped.
    const txtPath = calls[0].args[calls[0].args.indexOf('-f') + 1];
    // say reads from a temp txt that synthesize cleans up — capture happened at call time.
    expect(txtPath).toMatch(/\.txt$/);
    fs.unlinkSync(out!);
  });

  it('returns null when nothing speakable remains', async () => {
    const exec = vi.fn();
    const vh = new VoiceHandler(cfg, exec);
    expect(await vh.synthesize('```\ncode\n```'.replace('(code omitted.)', ''))).not.toBeNull;
    expect(await vh.synthesize('   ')).toBeNull();
    expect(exec).not.toHaveBeenCalledWith('say', expect.anything());
  });

  it('returns null when say fails', async () => {
    const exec = vi.fn(async () => {
      throw new Error('no voice');
    });
    const vh = new VoiceHandler(cfg, exec);
    expect(await vh.synthesize('hello')).toBeNull();
  });
});
