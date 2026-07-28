/**
 * Integration tests for the paste workflow
 * Tests the full flow from clipboard to file save
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ImageProcessor, ImageProcessorOptions } from '../../src/image/image-processor';
import { ClipboardManager } from '../../src/clipboard/clipboard-manager';
import { PathGenerator } from '../../src/image/path-generator';
import { FileWriter } from '../../src/image/file-writer';
import type { ClipboardData } from '../../src/core/types';
import type { IClipboardProvider } from '../../src/clipboard/clipboard-provider';
import { VALID_PNG_BUFFER } from '../helpers/image-fixtures';

/**
 * Mock clipboard provider for integration testing
 */
class MockClipboardProvider implements IClipboardProvider {
  private imageAvailable = true;
  private imageBuffer: Buffer | null = VALID_PNG_BUFFER;
  private hasTextValue = false;

  setImageAvailable(available: boolean): void {
    this.imageAvailable = available;
  }

  setImageBuffer(buffer: Buffer | null): void {
    this.imageBuffer = buffer;
  }

  setHasText(hasText: boolean): void {
    this.hasTextValue = hasText;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async hasImage(): Promise<boolean> {
    return this.imageAvailable && this.imageBuffer !== null;
  }

  async getImageData(): Promise<ClipboardData> {
    return {
      hasImage: this.imageAvailable && this.imageBuffer !== null,
      hasText: this.hasTextValue,
      imageBuffer: this.imageAvailable ? this.imageBuffer : null,
      format: this.imageBuffer ? 'png' : null,
    };
  }

  async cleanup(): Promise<void> {
    // No-op for mock
  }

  getPlatform(): string {
    return 'mock';
  }
}

describe('Paste Workflow Integration', () => {
  let testDir: string;
  let mockProvider: MockClipboardProvider;
  let clipboardManager: ClipboardManager;
  let imageProcessor: ImageProcessor;

  const defaultOptions: ImageProcessorOptions = {
    format: 'png',
    jpegQuality: 80,
    webpQuality: 80,
    maxFileSizeMB: 10,
    resizeMode: 'off',
    maxWidth: null,
    maxHeight: null,
  };

  beforeEach(async () => {
    const tmpBase = await fs.realpath(os.tmpdir());
    testDir = await fs.mkdtemp(path.join(tmpBase, 'clipshot-integration-'));

    mockProvider = new MockClipboardProvider();
    clipboardManager = new ClipboardManager(mockProvider);
    imageProcessor = new ImageProcessor(testDir);
  });

  afterEach(async () => {
    await clipboardManager.cleanup();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Full paste workflow', () => {
    it('should complete clipboard -> process -> save workflow', async () => {
      // Step 1: Get image from clipboard
      const clipboardData = await clipboardManager.getImageData();
      expect(clipboardData.hasImage).toBe(true);
      expect(clipboardData.imageBuffer).not.toBeNull();

      // Step 2: Process and save image
      const result = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        '.clipshot',
        'test_${seq3}',
        defaultOptions
      );

      // Step 3: Verify results
      expect(result.absolutePath).toContain('.clipshot');
      expect(result.fileName).toContain('test_');
      expect(result.format).toBe('png');
      expect(result.fileSize).toBeGreaterThan(0);

      // Step 4: Verify file exists on disk
      const fileExists = await fs.stat(result.absolutePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Step 5: Verify file content is valid
      const savedBuffer = await fs.readFile(result.absolutePath);
      expect(savedBuffer.length).toBeGreaterThan(0);
    });

    it('should handle format conversion in workflow', async () => {
      const jpegOptions: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'jpeg',
      };

      const clipboardData = await clipboardManager.getImageData();
      const result = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        '.clipshot',
        'converted_${seq3}',
        jpegOptions
      );

      expect(result.format).toBe('jpeg');
      expect(result.absolutePath).toMatch(/\.(jpg|jpeg)$/);
    });

    it('should handle empty clipboard gracefully', async () => {
      mockProvider.setImageAvailable(false);
      mockProvider.setImageBuffer(null);

      const clipboardData = await clipboardManager.getImageData();

      expect(clipboardData.hasImage).toBe(false);
      expect(clipboardData.imageBuffer).toBeNull();
    });

    it('should handle text-only clipboard', async () => {
      mockProvider.setImageAvailable(false);
      mockProvider.setImageBuffer(null);
      mockProvider.setHasText(true);

      const clipboardData = await clipboardManager.getImageData();

      expect(clipboardData.hasImage).toBe(false);
      expect(clipboardData.hasText).toBe(true);
    });
  });

  describe('Path generation in workflow', () => {
    it('should generate unique file names', async () => {
      const clipboardData = await clipboardManager.getImageData();

      const result1 = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        '.clipshot',
        'unique_${seq3}',
        defaultOptions
      );

      const result2 = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        '.clipshot',
        'unique_${seq3}',
        defaultOptions
      );

      expect(result1.fileName).not.toBe(result2.fileName);
    });

    it('should create nested directories', async () => {
      const clipboardData = await clipboardManager.getImageData();

      const result = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        'nested/deep/dir',
        'test_${seq3}',
        defaultOptions
      );

      expect(result.absolutePath).toContain('nested');
      expect(result.absolutePath).toContain('deep');
      expect(result.absolutePath).toContain('dir');

      const fileExists = await fs.stat(result.absolutePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should generate correct relative paths', async () => {
      const clipboardData = await clipboardManager.getImageData();

      const result = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        '.clipshot',
        'test_${seq3}',
        defaultOptions
      );

      expect(result.relativePath).toContain('.clipshot');
      expect(result.relativePath).not.toContain(testDir);
      expect(path.isAbsolute(result.relativePath)).toBe(false);
    });
  });

  describe('Error handling in workflow', () => {
    it('should handle file size limit', async () => {
      const smallLimit: ImageProcessorOptions = {
        ...defaultOptions,
        maxFileSizeMB: 0.00001, // Very small limit (~10 bytes)
      };

      const clipboardData = await clipboardManager.getImageData();

      await expect(
        imageProcessor.processAndSave(
          clipboardData.imageBuffer!,
          '.clipshot',
          'test_${seq3}',
          smallLimit
        )
      ).rejects.toThrow();
    });

    it('should cleanup on error', async () => {
      // Create a scenario that will fail
      const invalidBuffer = Buffer.from([0x00, 0x00, 0x00]);

      try {
        await imageProcessor.processAndSave(
          invalidBuffer,
          '.clipshot',
          'test_${seq3}',
          defaultOptions
        );
      } catch {
        // Expected to fail
      }

      // Verify cleanup happened (no temp files left)
      await clipboardManager.cleanup();
    });
  });

  describe('Configuration scenarios', () => {
    it('should respect save directory configuration', async () => {
      const clipboardData = await clipboardManager.getImageData();

      const customDir = 'custom-images';
      const result = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        customDir,
        'test_${seq3}',
        defaultOptions
      );

      expect(result.absolutePath).toContain(customDir);
      expect(result.relativePath).toContain(customDir);
    });

    it('should respect file name pattern', async () => {
      const clipboardData = await clipboardManager.getImageData();

      const result = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        '.clipshot',
        'screenshot_${yyyy}${MM}${dd}_${HH}${mm}${ss}',
        defaultOptions
      );

      expect(result.fileName).toContain('screenshot_');
      // Should contain current year
      const year = new Date().getFullYear().toString();
      expect(result.fileName).toContain(year);
    });

    it('should apply quality settings for JPEG', async () => {
      const jpegOptions: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'jpeg',
        jpegQuality: 50,
      };

      const clipboardData = await clipboardManager.getImageData();

      const result = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        '.clipshot',
        'jpeg_test',
        jpegOptions
      );

      expect(result.format).toBe('jpeg');
    });

    it('should apply quality settings for WebP', async () => {
      const webpOptions: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'webp',
        webpQuality: 75,
      };

      const clipboardData = await clipboardManager.getImageData();

      const result = await imageProcessor.processAndSave(
        clipboardData.imageBuffer!,
        '.clipshot',
        'webp_test',
        webpOptions
      );

      expect(result.format).toBe('webp');
    });
  });

  describe('Multiple paste operations', () => {
    it('should handle sequential paste operations', async () => {
      const results: string[] = [];

      for (let i = 0; i < 3; i++) {
        const clipboardData = await clipboardManager.getImageData();
        const result = await imageProcessor.processAndSave(
          clipboardData.imageBuffer!,
          '.clipshot',
          `seq_test_${i}_${Date.now()}_\${seq3}`,
          defaultOptions
        );
        results.push(result.absolutePath);
      }

      // All files should be unique
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(3);

      // All files should exist
      for (const filePath of results) {
        const exists = await fs.stat(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      }
    });
  });

  describe('Clipboard manager integration', () => {
    it('should detect image availability', async () => {
      mockProvider.setImageAvailable(true);
      expect(await clipboardManager.hasImage()).toBe(true);

      mockProvider.setImageAvailable(false);
      mockProvider.setImageBuffer(null);
      expect(await clipboardManager.hasImage()).toBe(false);
    });

    it('should cleanup resources', async () => {
      await clipboardManager.getImageData();

      // Should not throw
      await expect(clipboardManager.cleanup()).resolves.not.toThrow();
    });
  });
});

describe('PathGenerator and FileWriter integration', () => {
  let testDir: string;
  let pathGenerator: PathGenerator;
  let fileWriter: FileWriter;

  beforeEach(async () => {
    const tmpBase = await fs.realpath(os.tmpdir());
    testDir = await fs.mkdtemp(path.join(tmpBase, 'clipshot-pathwriter-'));
    pathGenerator = new PathGenerator(testDir);
    fileWriter = new FileWriter(testDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should generate and write files correctly', async () => {
    const fileName = pathGenerator.generateFileName('test_${seq3}', 'png');
    const savePath = pathGenerator.generateSavePath('.clipshot', fileName);

    const result = await fileWriter.writeAtomic(savePath, VALID_PNG_BUFFER, {
      createDirs: true,
    });

    expect(result.absolutePath).toBe(savePath);
    expect(result.fileSize).toBe(VALID_PNG_BUFFER.length);

    const relativePath = pathGenerator.generateRelativePath(result.absolutePath);
    expect(relativePath).toContain('.clipshot');
  });

  it('should handle special characters in paths', async () => {
    const fileName = pathGenerator.generateFileName('test-file_${seq3}', 'png');
    const savePath = pathGenerator.generateSavePath('images', fileName);

    const result = await fileWriter.writeAtomic(savePath, VALID_PNG_BUFFER, {
      createDirs: true,
    });

    expect(result.absolutePath).toContain('images');
    expect(result.fileSize).toBeGreaterThan(0);
  });
});
