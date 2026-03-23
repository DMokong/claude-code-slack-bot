import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger';
import { config } from './config';

export interface ProcessedFile {
  path: string;
  name: string;
  mimetype: string;
  isImage: boolean;
  isText: boolean;
  size: number;
  tempPath?: string;
}

export class FileHandler {
  private logger = new Logger('FileHandler');

  /**
   * Download files with optional channel-aware routing.
   * For #cc-finance, files are saved to data/finance/inbox/ instead of temp dir.
   */
  async downloadAndProcessFiles(files: any[], options?: { channelId?: string; financeChannelId?: string; financeInboxPath?: string }): Promise<ProcessedFile[]> {
    const processedFiles: ProcessedFile[] = [];

    const isFinanceChannel = options?.channelId && options?.financeChannelId
      && options.channelId === options.financeChannelId;
    const targetDir = isFinanceChannel && options?.financeInboxPath
      ? options.financeInboxPath : undefined;

    if (isFinanceChannel) {
      this.logger.info('Finance channel detected — routing files to finance inbox', {
        targetDir,
      });
    }

    for (const file of files) {
      try {
        const processed = await this.downloadFile(file, targetDir);
        if (processed) {
          processedFiles.push(processed);
        }
      } catch (error) {
        this.logger.error(`Failed to process file ${file.name}`, error);
      }
    }

    return processedFiles;
  }

  isFinanceChannel(channelId: string, financeChannelId: string): boolean {
    return !!financeChannelId && channelId === financeChannelId;
  }

  private async downloadFile(file: any, targetDir?: string): Promise<ProcessedFile | null> {
    // Check file size limit (50MB)
    if (file.size > 50 * 1024 * 1024) {
      this.logger.warn('File too large, skipping', { name: file.name, size: file.size });
      return null;
    }

    try {
      this.logger.debug('Downloading file', { name: file.name, mimetype: file.mimetype });

      const response = await fetch(file.url_private_download, {
        headers: {
          'Authorization': `Bearer ${config.slack.botToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.buffer();
      const saveDir = targetDir || os.tmpdir();
      if (targetDir) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const tempPath = targetDir
        ? path.join(saveDir, file.name)
        : path.join(saveDir, `slack-file-${Date.now()}-${file.name}`);
      
      fs.writeFileSync(tempPath, buffer);

      const processed: ProcessedFile = {
        path: tempPath,
        name: file.name,
        mimetype: file.mimetype,
        isImage: this.isImageFile(file.mimetype),
        isText: this.isTextFile(file.mimetype),
        size: file.size,
        tempPath,
      };

      this.logger.info('File downloaded successfully', {
        name: file.name,
        tempPath,
        isImage: processed.isImage,
        isText: processed.isText,
      });

      return processed;
    } catch (error) {
      this.logger.error('Failed to download file', error);
      return null;
    }
  }

  private isImageFile(mimetype: string): boolean {
    return mimetype.startsWith('image/');
  }

  private isTextFile(mimetype: string): boolean {
    const textTypes = [
      'text/',
      'application/json',
      'application/javascript',
      'application/typescript',
      'application/xml',
      'application/yaml',
      'application/x-yaml',
    ];

    return textTypes.some(type => mimetype.startsWith(type));
  }

  async formatFilePrompt(files: ProcessedFile[], userText: string, options?: { isFinanceChannel?: boolean }): Promise<string> {
    let prompt = userText || 'Please analyze the uploaded files.';

    if (options?.isFinanceChannel && files.length > 0) {
      const fileNames = files.map(f => f.name).join(', ');
      prompt = `${userText || ''}\n\nFinancial files received and saved to data/finance/inbox/: ${fileNames}\n\nPlease run the finance ingestion pipeline to process these files. Read the ingestion prompt at tasks/prompts/finance-ingest.md and execute it to parse, categorize, and store the transactions.`.trim();
      return prompt;
    }

    if (files.length > 0) {
      prompt += '\n\nUploaded files:\n';
      
      for (const file of files) {
        if (file.isImage) {
          prompt += `\n## Image: ${file.name}\n`;
          prompt += `File type: ${file.mimetype}\n`;
          prompt += `Path: ${file.path}\n`;
          prompt += `Note: This is an image file that has been uploaded. You can analyze it using the Read tool to examine the image content.\n`;
        } else if (file.isText) {
          prompt += `\n## File: ${file.name}\n`;
          prompt += `File type: ${file.mimetype}\n`;
          
          try {
            const content = fs.readFileSync(file.path, 'utf-8');
            if (content.length > 10000) {
              prompt += `Content (truncated to first 10000 characters):\n\`\`\`\n${content.substring(0, 10000)}...\n\`\`\`\n`;
            } else {
              prompt += `Content:\n\`\`\`\n${content}\n\`\`\`\n`;
            }
          } catch (error) {
            prompt += `Error reading file content: ${error}\n`;
          }
        } else {
          prompt += `\n## File: ${file.name}\n`;
          prompt += `File type: ${file.mimetype}\n`;
          prompt += `Size: ${file.size} bytes\n`;
          prompt += `Note: This is a binary file. Content analysis may be limited.\n`;
        }
      }
      
      prompt += '\nPlease analyze these files and provide insights or assistance based on their content.';
    }

    return prompt;
  }

  async cleanupTempFiles(files: ProcessedFile[]): Promise<void> {
    for (const file of files) {
      if (file.tempPath) {
        try {
          fs.unlinkSync(file.tempPath);
          this.logger.debug('Cleaned up temp file', { path: file.tempPath });
        } catch (error) {
          this.logger.warn('Failed to cleanup temp file', { path: file.tempPath, error });
        }
      }
    }
  }

  getSupportedFileTypes(): string[] {
    return [
      'Images: jpg, png, gif, webp, svg',
      'Text files: txt, md, json, js, ts, py, java, etc.',
      'Documents: pdf, docx (limited support)',
      'Code files: most programming languages',
    ];
  }
}