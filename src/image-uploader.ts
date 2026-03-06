import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
]);

const IMAGE_PATH_REGEX = /(?:\/[\w._-]+)+\.(?:png|jpe?g|gif|webp|svg|bmp)\b/gi;

const DEFAULT_MAX_UPLOADS = 10;

export class ImageUploader {
  private client: any;
  private logger = new Logger('ImageUploader');

  constructor(client: any) {
    this.client = client;
  }

  static isImagePath(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  }

  static extractImagePaths(text: string): string[] {
    const matches = text.match(IMAGE_PATH_REGEX) || [];
    return [...new Set(matches)];
  }

  async uploadImage(filePath: string, channelId: string, threadTs: string): Promise<boolean> {
    if (!fs.existsSync(filePath)) {
      this.logger.warn('Image file not found, skipping upload', { filePath });
      return false;
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const filename = path.basename(filePath);

      await this.client.files.uploadV2({
        channel_id: channelId,
        thread_ts: threadTs,
        file: fileBuffer,
        filename,
        initial_comment: `🖼️ ${filename}`,
      });

      this.logger.info('Uploaded image to Slack', { filePath, channelId });
      return true;
    } catch (error) {
      this.logger.error('Failed to upload image to Slack', { filePath, error });
      return false;
    }
  }

  async uploadImages(
    filePaths: string[],
    channelId: string,
    threadTs: string,
    maxUploads: number = DEFAULT_MAX_UPLOADS,
  ): Promise<number> {
    const unique = [...new Set(filePaths)];
    const toUpload = unique.slice(0, maxUploads);
    let uploaded = 0;

    for (const filePath of toUpload) {
      const success = await this.uploadImage(filePath, channelId, threadTs);
      if (success) uploaded++;
    }

    if (unique.length > maxUploads) {
      this.logger.warn('Image upload cap reached', {
        total: unique.length,
        uploaded: maxUploads,
        skipped: unique.length - maxUploads,
      });
    }

    return uploaded;
  }
}
