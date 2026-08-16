import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger';

const execFileP = promisify(execFile);

export interface VoiceConfig {
  enabled: boolean;
  whisperBin: string;
  whisperModel: string;
  ffmpegBin: string;
  ttsVoice: string;
  ttsRate: number;
  maxSpeechChars: number;
}

export type Exec = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: Exec = async (cmd, args, opts) => {
  const { stdout, stderr } = await execFileP(cmd, args, {
    timeout: opts?.timeout ?? 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

/**
 * Local, zero-subscription voice lane (claw walkie-talkie): whisper.cpp for
 * inbound voice-memo transcription, macOS `say` + ffmpeg for spoken replies.
 * Every tool is a local binary — no API keys, no network calls.
 */
export class VoiceHandler {
  private logger = new Logger('VoiceHandler');

  constructor(
    private cfg: VoiceConfig,
    private exec: Exec = defaultExec,
  ) {}

  /** Slack voice clips arrive as audio/mp4 (sometimes video/mp4 named audio_*). */
  isVoiceFile(file: { mimetype?: string; name?: string }): boolean {
    const mimetype = (file.mimetype || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    if (mimetype.startsWith('audio/')) return true;
    if (mimetype.startsWith('video/')) {
      return mimetype === 'video/mp4' && /audio/.test(name);
    }
    if (mimetype.startsWith('image/')) return false;
    return /\.(m4a|mp3|wav|ogg|oga|opus|flac|amr)$/.test(name);
  }

  /** Voice memo file → text via ffmpeg (16k mono wav) + whisper-cli. */
  async transcribe(audioPath: string): Promise<string | null> {
    const wav = path.join(os.tmpdir(), `voice-in-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`);
    try {
      await this.exec(
        this.cfg.ffmpegBin,
        ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-f', 'wav', wav],
        { timeout: 60_000 },
      );
      const { stdout } = await this.exec(
        this.cfg.whisperBin,
        ['-m', this.cfg.whisperModel, '-f', wav, '--no-prints', '--no-timestamps', '-l', 'en'],
        { timeout: 300_000 },
      );
      const text = stdout
        .replace(/\[[A-Z_ ]+\]/g, ' ') // [BLANK_AUDIO] and friends
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return null;
      this.logger.info('Transcribed voice memo', { audioPath, chars: text.length });
      return text;
    } catch (error) {
      this.logger.error('Transcription failed', { audioPath, error });
      return null;
    } finally {
      try {
        fs.unlinkSync(wav);
      } catch {
        /* never created */
      }
    }
  }

  /** Final reply text → spoken m4a (say → aiff → ffmpeg aac). Null on failure. */
  async synthesize(mrkdwnText: string): Promise<string | null> {
    const speech = this.prepareSpeechText(mrkdwnText);
    if (!speech) return null;
    const base = path.join(os.tmpdir(), `cindy-voice-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    const txt = `${base}.txt`;
    const aiff = `${base}.aiff`;
    const m4a = `${base}.m4a`;
    try {
      fs.writeFileSync(txt, speech, 'utf-8');
      await this.exec(
        'say',
        ['-v', this.cfg.ttsVoice, '-r', String(this.cfg.ttsRate), '-o', aiff, '-f', txt],
        { timeout: 180_000 },
      );
      await this.exec(this.cfg.ffmpegBin, ['-y', '-i', aiff, '-c:a', 'aac', '-b:a', '80k', m4a], {
        timeout: 60_000,
      });
      if (!fs.existsSync(m4a) || fs.statSync(m4a).size === 0) {
        this.logger.warn('TTS produced no audio', { m4a });
        return null;
      }
      this.logger.info('Synthesized voice reply', { chars: speech.length, m4a });
      return m4a;
    } catch (error) {
      this.logger.error('TTS synthesis failed', { error });
      return null;
    } finally {
      for (const f of [txt, aiff]) {
        try {
          fs.unlinkSync(f);
        } catch {
          /* never created */
        }
      }
    }
  }

  /** Slack mrkdwn → speakable prose: drop code, unwrap links, strip markers. */
  prepareSpeechText(input: string): string {
    let t = input;
    t = t.replace(/```[\s\S]*?```/g, ' (code omitted.) ');
    t = t.replace(/^>\s?/gm, '');
    t = t.replace(/<(?:https?:)[^|>]+\|([^>]+)>/g, '$1');
    t = t.replace(/<https?:[^>]+>/g, '(link)');
    t = t.replace(/<#[^|>]+\|([^>]+)>/g, '$1');
    t = t.replace(/<[@#!][^>]*>/g, '');
    t = t.replace(/`([^`\n]*)`/g, '$1');
    t = t.replace(/\*([^*\n]+)\*/g, '$1');
    t = t.replace(/_([^_\n]+)_/g, '$1');
    t = t.replace(/~([^~\n]+)~/g, '$1');
    t = t.replace(/:[a-z0-9_+-]+:/gi, ' ');
    t = t.replace(/^[ \t]*[•\-*]\s+/gm, '');
    t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    t = t
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
    if (t.length > this.cfg.maxSpeechChars) {
      t = `${t.slice(0, this.cfg.maxSpeechChars)}… message truncated.`;
    }
    return t;
  }
}
