import { describe, it, expect } from 'vitest';
import { emojiToShortcode } from './slack-handler';

describe('emojiToShortcode', () => {
  describe('AC1 - Unicode emoji converts to shortcode', () => {
    it('converts thinking face', () => {
      expect(emojiToShortcode('\u{1F914}')).toBe('thinking_face');
    });

    it('converts gear (with variation selector)', () => {
      expect(emojiToShortcode('\u2699\uFE0F')).toBe('gear');
    });

    it('converts gear (without variation selector)', () => {
      expect(emojiToShortcode('\u2699')).toBe('gear');
    });

    it('converts white check mark', () => {
      expect(emojiToShortcode('\u2705')).toBe('white_check_mark');
    });

    it('converts x / cross mark', () => {
      expect(emojiToShortcode('\u274C')).toBe('x');
    });

    it('converts stop button (with variation selector)', () => {
      expect(emojiToShortcode('\u23F9\uFE0F')).toBe('stop_button');
    });

    it('converts stop button (without variation selector)', () => {
      expect(emojiToShortcode('\u23F9')).toBe('stop_button');
    });

    it('converts arrows counterclockwise', () => {
      expect(emojiToShortcode('\u{1F504}')).toBe('arrows_counterclockwise');
    });

    it('converts clipboard', () => {
      expect(emojiToShortcode('\u{1F4CB}')).toBe('clipboard');
    });
  });

  describe('AC2 - Shortcode passthrough', () => {
    it('passes through "thumbsup" unchanged', () => {
      expect(emojiToShortcode('thumbsup')).toBe('thumbsup');
    });

    it('passes through "thinking_face" unchanged', () => {
      expect(emojiToShortcode('thinking_face')).toBe('thinking_face');
    });

    it('passes through shortcodes with hyphens and numbers', () => {
      expect(emojiToShortcode('heart-eyes')).toBe('heart-eyes');
    });

    it('passes through shortcodes with plus sign', () => {
      expect(emojiToShortcode('+1')).toBe('+1');
    });
  });

  describe('AC3 - Empty input', () => {
    it('returns empty string for empty input', () => {
      expect(emojiToShortcode('')).toBe('');
    });
  });

  describe('AC4 - Unmapped Unicode', () => {
    it('returns empty string for unmapped emoji (unicorn)', () => {
      expect(emojiToShortcode('\u{1F984}')).toBe('');
    });

    it('returns empty string for unmapped emoji (fire)', () => {
      expect(emojiToShortcode('\u{1F525}')).toBe('');
    });
  });

});
