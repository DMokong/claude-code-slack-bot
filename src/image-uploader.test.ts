import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ImageUploader } from './image-uploader';

describe('ImageUploader', () => {
  let uploader: ImageUploader;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      files: {
        uploadV2: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    uploader = new ImageUploader(mockClient);
  });

  describe('isImagePath', () => {
    it('returns true for .png files', () => {
      expect(ImageUploader.isImagePath('/tmp/logo.png')).toBe(true);
    });

    it('returns true for .jpg files', () => {
      expect(ImageUploader.isImagePath('/home/user/photo.jpg')).toBe(true);
    });

    it('returns true for .jpeg files', () => {
      expect(ImageUploader.isImagePath('/tmp/image.jpeg')).toBe(true);
    });

    it('returns true for .gif files', () => {
      expect(ImageUploader.isImagePath('/tmp/animation.gif')).toBe(true);
    });

    it('returns true for .webp files', () => {
      expect(ImageUploader.isImagePath('/tmp/photo.webp')).toBe(true);
    });

    it('returns true for .svg files', () => {
      expect(ImageUploader.isImagePath('/tmp/icon.svg')).toBe(true);
    });

    it('returns true for .bmp files', () => {
      expect(ImageUploader.isImagePath('/tmp/old.bmp')).toBe(true);
    });

    it('returns false for .ts files', () => {
      expect(ImageUploader.isImagePath('/src/index.ts')).toBe(false);
    });

    it('returns false for .md files', () => {
      expect(ImageUploader.isImagePath('/docs/README.md')).toBe(false);
    });

    it('returns false for .json files', () => {
      expect(ImageUploader.isImagePath('/config.json')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(ImageUploader.isImagePath('/tmp/logo.PNG')).toBe(true);
      expect(ImageUploader.isImagePath('/tmp/logo.Jpg')).toBe(true);
    });
  });

  describe('extractImagePaths', () => {
    it('extracts absolute paths ending in image extensions', () => {
      const text = 'Saved image to /tmp/output/chart.png and done.';
      expect(ImageUploader.extractImagePaths(text)).toEqual(['/tmp/output/chart.png']);
    });

    it('extracts multiple image paths', () => {
      const text = 'Created /tmp/a.png and /tmp/b.jpg files.';
      const paths = ImageUploader.extractImagePaths(text);
      expect(paths).toContain('/tmp/a.png');
      expect(paths).toContain('/tmp/b.jpg');
    });

    it('returns empty array for text with no image paths', () => {
      expect(ImageUploader.extractImagePaths('Just some text.')).toEqual([]);
    });

    it('deduplicates paths', () => {
      const text = '/tmp/a.png and again /tmp/a.png';
      expect(ImageUploader.extractImagePaths(text)).toEqual(['/tmp/a.png']);
    });

    it('handles paths with hyphens and underscores', () => {
      const text = 'File at /tmp/my-image_v2.png';
      expect(ImageUploader.extractImagePaths(text)).toEqual(['/tmp/my-image_v2.png']);
    });

    it('resolves paths via cwd/local/ when cwd is provided', () => {
      // Create a temp directory structure: cwd/local/2026/03/img.png
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'img-test-'));
      const localDir = path.join(cwd, 'local', '2026', '03');
      fs.mkdirSync(localDir, { recursive: true });
      const imgPath = path.join(localDir, 'pirate-cat.png');
      fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const text = 'Image at /2026/03/pirate-cat.png done';
      const result = ImageUploader.extractImagePaths(text, cwd);

      expect(result).toEqual([imgPath]);

      // Cleanup
      fs.rmSync(cwd, { recursive: true });
    });

    it('returns original path when cwd resolution fails', () => {
      const text = 'Image at /nonexistent/path/img.png';
      const result = ImageUploader.extractImagePaths(text, '/tmp/no-such-cwd');
      expect(result).toEqual(['/nonexistent/path/img.png']);
    });
  });

  describe('resolveImagePath', () => {
    it('returns path as-is if it exists on disk', () => {
      const tmpFile = path.join(os.tmpdir(), `resolve-test-${Date.now()}.png`);
      fs.writeFileSync(tmpFile, Buffer.from([0x89]));

      expect(ImageUploader.resolveImagePath(tmpFile, '/some/cwd')).toBe(tmpFile);

      fs.unlinkSync(tmpFile);
    });

    it('resolves via cwd/local/ for image-gen file:// paths', () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-'));
      const localDir = path.join(cwd, 'local', '2026', '03');
      fs.mkdirSync(localDir, { recursive: true });
      const imgPath = path.join(localDir, 'cat.png');
      fs.writeFileSync(imgPath, Buffer.from([0x89]));

      expect(ImageUploader.resolveImagePath('/2026/03/cat.png', cwd)).toBe(imgPath);

      fs.rmSync(cwd, { recursive: true });
    });

    it('resolves relative to cwd as fallback', () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-'));
      const imgPath = path.join(cwd, '2026', '03', 'cat.png');
      fs.mkdirSync(path.join(cwd, '2026', '03'), { recursive: true });
      fs.writeFileSync(imgPath, Buffer.from([0x89]));

      expect(ImageUploader.resolveImagePath('/2026/03/cat.png', cwd)).toBe(imgPath);

      fs.rmSync(cwd, { recursive: true });
    });

    it('returns original path when nothing resolves', () => {
      expect(ImageUploader.resolveImagePath('/no/such/file.png', '/tmp')).toBe('/no/such/file.png');
    });
  });

  describe('uploadImage', () => {
    let tempFile: string;

    beforeEach(() => {
      tempFile = path.join(os.tmpdir(), `test-image-${Date.now()}.png`);
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      fs.writeFileSync(tempFile, pngHeader);
    });

    afterEach(() => {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    });

    it('uploads the file to Slack', async () => {
      await uploader.uploadImage(tempFile, 'C123', '1234.5678');

      expect(mockClient.files.uploadV2).toHaveBeenCalledWith({
        channel_id: 'C123',
        thread_ts: '1234.5678',
        file: expect.any(Buffer),
        filename: path.basename(tempFile),
        initial_comment: expect.stringContaining(path.basename(tempFile)),
      });
    });

    it('skips upload if file does not exist', async () => {
      await uploader.uploadImage('/nonexistent/file.png', 'C123', '1234.5678');
      expect(mockClient.files.uploadV2).not.toHaveBeenCalled();
    });

    it('does not throw on upload failure', async () => {
      mockClient.files.uploadV2.mockRejectedValue(new Error('Slack error'));
      await expect(uploader.uploadImage(tempFile, 'C123', '1234.5678')).resolves.not.toThrow();
    });
  });

  describe('uploadImages (batch with cap)', () => {
    let tempFiles: string[] = [];

    function createTempImages(count: number): string[] {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const paths: string[] = [];
      for (let i = 0; i < count; i++) {
        const p = path.join(os.tmpdir(), `test-batch-${Date.now()}-${i}.png`);
        fs.writeFileSync(p, pngHeader);
        paths.push(p);
        tempFiles.push(p);
      }
      return paths;
    }

    afterEach(() => {
      for (const f of tempFiles) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      tempFiles = [];
    });

    it('respects the max upload cap', async () => {
      const paths = createTempImages(15);

      await uploader.uploadImages(paths, 'C123', '1234.5678');

      expect(mockClient.files.uploadV2).toHaveBeenCalledTimes(10);
    });

    it('deduplicates paths before uploading', async () => {
      const paths = createTempImages(2);

      await uploader.uploadImages([paths[0], paths[0], paths[1]], 'C123', '1234.5678');

      expect(mockClient.files.uploadV2).toHaveBeenCalledTimes(2);
    });
  });
});
