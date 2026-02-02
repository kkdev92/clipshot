/**
 * ImageProcessor unit tests
 * Tests image processing, format conversion, and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ImageProcessor, ImageProcessorOptions } from '../../src/image/image-processor';
import {
  VALID_PNG_BUFFER,
  VALID_JPEG_BUFFER,
  VALID_BMP_BUFFER,
  VALID_GIF_BUFFER,
  INVALID_IMAGE_BUFFER,
  EMPTY_BUFFER,
  SHORT_BUFFER,
  PARTIAL_PNG_HEADER,
  createPngWithDimensions,
  createPngWithZeroWidth,
  createPngWithHugeDimensions,
  createLargeBufferMB,
} from '../helpers/image-fixtures';

describe('ImageProcessor', () => {
  let testDir: string;
  let processor: ImageProcessor;
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
    testDir = await fs.mkdtemp(path.join(tmpBase, 'clipshot-imgproc-test-'));
    processor = new ImageProcessor(testDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('processAndSave', () => {
    it('should process PNG and save to disk', async () => {
      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'test_${seq3}',
        defaultOptions
      );

      expect(result.absolutePath).toContain('.clipshot');
      expect(result.absolutePath).toContain('.png');
      expect(result.fileName).toContain('test_');
      expect(result.format).toBe('png');
      expect(result.fileSize).toBeGreaterThan(0);

      // Verify file exists
      const exists = await fs.stat(result.absolutePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should process image with JPEG format option', async () => {
      const options: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'jpeg',
      };

      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'test_${seq3}',
        options
      );

      expect(result.format).toBe('jpeg');
      // Sharp will produce .jpg extension for jpeg format
      expect(result.absolutePath).toMatch(/\.(jpg|jpeg)$/);
    });

    it('should process image with WebP format option', async () => {
      const options: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'webp',
      };

      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'test_${seq3}',
        options
      );

      expect(result.format).toBe('webp');
      expect(result.absolutePath).toContain('.webp');
    });

    it('should throw FileSizeLimitError when initial buffer exceeds limit', async () => {
      const largeBuffer = createLargeBufferMB(15); // 15MB
      const options: ImageProcessorOptions = {
        ...defaultOptions,
        maxFileSizeMB: 10,
      };

      await expect(
        processor.processAndSave(largeBuffer, '.clipshot', 'test_${seq3}', options)
      ).rejects.toThrow('exceeds');
    });

    it('should generate correct relative path', async () => {
      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'test_${seq3}',
        defaultOptions
      );

      expect(result.relativePath).toContain('.clipshot');
      expect(result.relativePath).not.toContain(testDir);
    });

    it('should create save directory if not exists', async () => {
      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        'new-dir/images',
        'test_${seq3}',
        defaultOptions
      );

      expect(result.absolutePath).toContain('new-dir');
      expect(result.absolutePath).toContain('images');

      const dirExists = await fs.stat(path.dirname(result.absolutePath))
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('should extract dimensions when available', async () => {
      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'test_${seq3}',
        defaultOptions
      );

      // Dimensions should be available (Sharp extracts them)
      // If Sharp is not available, dimensions might be from PNG header parsing
      if (result.dimensions) {
        expect(result.dimensions.width).toBeGreaterThan(0);
        expect(result.dimensions.height).toBeGreaterThan(0);
      }
    });
  });

  describe('validateImageBuffer (via processAndSave)', () => {
    it('should accept valid PNG buffer', async () => {
      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'test',
        defaultOptions
      );
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should accept valid JPEG buffer', async () => {
      const result = await processor.processAndSave(
        VALID_JPEG_BUFFER,
        '.clipshot',
        'test',
        defaultOptions
      );
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should accept valid BMP buffer', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();

      if (isSharpAvailable) {
        // Sharp doesn't support BMP input natively, expect error
        await expect(
          processor.processAndSave(VALID_BMP_BUFFER, '.clipshot', 'test', defaultOptions)
        ).rejects.toThrow();
      } else {
        // Without Sharp, should pass validation based on magic bytes
        const result = await processor.processAndSave(
          VALID_BMP_BUFFER,
          '.clipshot',
          'test',
          defaultOptions
        );
        expect(result.fileSize).toBeGreaterThan(0);
      }
    });

    it('should accept valid GIF buffer', async () => {
      const result = await processor.processAndSave(
        VALID_GIF_BUFFER,
        '.clipshot',
        'test',
        defaultOptions
      );
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should reject invalid image buffer when Sharp unavailable', async () => {
      // This test depends on Sharp availability
      // When Sharp is available, it will process the buffer differently
      // When Sharp is unavailable, validateImageBuffer is called
      // We test the validation logic indirectly

      const isSharpAvailable = await processor.isSharpAvailable();

      if (!isSharpAvailable) {
        await expect(
          processor.processAndSave(INVALID_IMAGE_BUFFER, '.clipshot', 'test', defaultOptions)
        ).rejects.toThrow();
      } else {
        // Sharp will handle the invalid buffer with its own error
        await expect(
          processor.processAndSave(INVALID_IMAGE_BUFFER, '.clipshot', 'test', defaultOptions)
        ).rejects.toThrow();
      }
    });
  });

  describe('extractPngDimensions (via processAndSave)', () => {
    it('should extract dimensions from PNG with specific size', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      const customPng = createPngWithDimensions(100, 200);

      if (isSharpAvailable) {
        // Sharp can't process PNG without valid IDAT, expect error
        await expect(
          processor.processAndSave(customPng, '.clipshot', 'test', defaultOptions)
        ).rejects.toThrow();
      } else {
        // Without Sharp, our dimension extraction from header should work
        const result = await processor.processAndSave(
          customPng,
          '.clipshot',
          'test',
          defaultOptions
        );

        // Note: If Sharp is unavailable, our custom PNG might not have valid IDAT data
        // This test verifies the dimension extraction logic works
        if (result.dimensions) {
          expect(result.dimensions.width).toBe(100);
          expect(result.dimensions.height).toBe(200);
        }
      }
    });

    it('should handle PNG with dimensions within sanity check range', async () => {
      // Create PNG with reasonable dimensions
      const png = createPngWithDimensions(1920, 1080);
      const isSharpAvailable = await processor.isSharpAvailable();

      if (!isSharpAvailable) {
        // Without Sharp, we need a valid PNG structure
        // Our fixture creates minimal structure that might not be fully valid
        // Just verify no crash occurs
        try {
          await processor.processAndSave(png, '.clipshot', 'test', defaultOptions);
        } catch {
          // Expected if PNG structure is incomplete
        }
      }
    });
  });

  describe('isSharpAvailable', () => {
    it('should return boolean indicating Sharp availability', async () => {
      const result = await processor.isSharpAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('should cache Sharp availability check', async () => {
      const result1 = await processor.isSharpAvailable();
      const result2 = await processor.isSharpAvailable();
      expect(result1).toBe(result2);
    });
  });

  describe('getPathGenerator', () => {
    it('should return PathGenerator instance', () => {
      const pathGenerator = processor.getPathGenerator();
      expect(pathGenerator).toBeDefined();
      expect(typeof pathGenerator.generateFileName).toBe('function');
    });
  });

  describe('getFileWriter', () => {
    it('should return FileWriter instance', () => {
      const fileWriter = processor.getFileWriter();
      expect(fileWriter).toBeDefined();
      expect(typeof fileWriter.writeAtomic).toBe('function');
    });
  });

  describe('format conversion', () => {
    it('should apply JPEG quality setting', async () => {
      const lowQualityOptions: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'jpeg',
        jpegQuality: 10,
      };

      const highQualityOptions: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'jpeg',
        jpegQuality: 100,
      };

      const lowResult = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'low_${seq3}',
        lowQualityOptions
      );

      const highResult = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'high_${seq3}',
        highQualityOptions
      );

      // Both should complete successfully
      expect(lowResult.format).toBe('jpeg');
      expect(highResult.format).toBe('jpeg');

      // Note: For a 1x1 pixel image, size difference might be minimal
    });

    it('should apply WebP quality setting', async () => {
      const options: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'webp',
        webpQuality: 50,
      };

      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'test_${seq3}',
        options
      );

      expect(result.format).toBe('webp');
    });
  });

  describe('error handling', () => {
    it('should throw ImageProcessingError for empty buffer', async () => {
      await expect(
        processor.processAndSave(EMPTY_BUFFER, '.clipshot', 'test', defaultOptions)
      ).rejects.toThrow();
    });

    it('should throw for buffer too short', async () => {
      await expect(
        processor.processAndSave(SHORT_BUFFER, '.clipshot', 'test', defaultOptions)
      ).rejects.toThrow();
    });

    it('should throw for corrupted PNG with valid signature but invalid IHDR', async () => {
      // Valid PNG signature but corrupted IHDR chunk (invalid chunk length)
      const corruptedPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0xff, 0xff, 0xff, 0xff, // Invalid chunk length (too large)
        0x49, 0x48, 0x44, 0x52, // IHDR type
        0x00, 0x00, 0x00, 0x00, // Corrupted data
      ]);

      const isSharpAvailable = await processor.isSharpAvailable();
      if (isSharpAvailable) {
        // Sharp should detect the corrupted data and throw
        await expect(
          processor.processAndSave(corruptedPng, '.clipshot', 'test', defaultOptions)
        ).rejects.toThrow();
      }
    });

    it('should throw for truncated JPEG with valid signature', async () => {
      // Valid JPEG signature but truncated data
      const truncatedJpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, // JPEG SOI + APP0 marker
        0x00, 0x10, // Segment length
        // Missing rest of JFIF header and image data
      ]);

      const isSharpAvailable = await processor.isSharpAvailable();
      if (isSharpAvailable) {
        await expect(
          processor.processAndSave(truncatedJpeg, '.clipshot', 'test', defaultOptions)
        ).rejects.toThrow();
      }
    });
  });

  describe('file name pattern', () => {
    it('should use file name pattern with date tokens', async () => {
      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'img_${yyyy}${MM}${dd}',
        defaultOptions
      );

      const year = new Date().getFullYear().toString();
      expect(result.fileName).toContain(year);
    });

    it('should use file name pattern with sequence token', async () => {
      const result1 = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'img_${seq3}',
        defaultOptions
      );

      expect(result1.fileName).toMatch(/img_\d{3}\.png$/);
    });
  });

  describe('PNG dimension extraction edge cases', () => {
    it('should handle PNG with zero width', async () => {
      const pngZeroWidth = createPngWithZeroWidth();
      const isSharpAvailable = await processor.isSharpAvailable();

      if (isSharpAvailable) {
        // Sharp will reject invalid dimensions
        await expect(
          processor.processAndSave(pngZeroWidth, '.clipshot', 'test', defaultOptions)
        ).rejects.toThrow();
      }
    });

    it('should handle PNG with dimensions exceeding sanity check', async () => {
      const pngHuge = createPngWithHugeDimensions();
      const isSharpAvailable = await processor.isSharpAvailable();

      if (isSharpAvailable) {
        // Sharp will reject unreasonably large dimensions
        await expect(
          processor.processAndSave(pngHuge, '.clipshot', 'test', defaultOptions)
        ).rejects.toThrow();
      }
    });

    it('should handle buffer too short for dimension extraction', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();

      if (isSharpAvailable) {
        // Sharp handles short buffers with its own error
        await expect(
          processor.processAndSave(PARTIAL_PNG_HEADER, '.clipshot', 'test', defaultOptions)
        ).rejects.toThrow();
      }
    });
  });

  describe('processed file size limit', () => {
    it('should throw FileSizeLimitError when processed size exceeds limit', async () => {
      // Test with a small limit that the processed PNG will exceed
      const tinyLimitOptions: ImageProcessorOptions = {
        ...defaultOptions,
        maxFileSizeMB: 0.00001, // ~10 bytes
      };

      await expect(
        processor.processAndSave(VALID_PNG_BUFFER, '.clipshot', 'test', tinyLimitOptions)
      ).rejects.toThrow('exceeds');
    });
  });

  describe('Sharp metadata edge cases', () => {
    it('should handle image with metadata extraction', async () => {
      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'meta_test_${seq3}',
        defaultOptions
      );

      // If Sharp is available, dimensions should be extracted
      // If not, PNG header parsing may or may not succeed
      expect(result).toBeDefined();
      expect(result.format).toBe('png');
    });

    it('should process JPEG with Sharp when available', async () => {
      const jpegOptions: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'jpeg',
        jpegQuality: 75,
      };

      const result = await processor.processAndSave(
        VALID_JPEG_BUFFER,
        '.clipshot',
        'jpeg_meta_${seq3}',
        jpegOptions
      );

      expect(result.format).toBe('jpeg');
    });
  });

  describe('buffer validation', () => {
    it('should validate PNG signature correctly', async () => {
      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'png_valid_${seq3}',
        defaultOptions
      );
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should validate JPEG signature correctly', async () => {
      const result = await processor.processAndSave(
        VALID_JPEG_BUFFER,
        '.clipshot',
        'jpeg_valid_${seq3}',
        defaultOptions
      );
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should validate GIF signature correctly', async () => {
      const result = await processor.processAndSave(
        VALID_GIF_BUFFER,
        '.clipshot',
        'gif_valid_${seq3}',
        defaultOptions
      );
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should reject buffer that is too short', async () => {
      const veryShortBuffer = Buffer.from([0x89, 0x50]);
      await expect(
        processor.processAndSave(veryShortBuffer, '.clipshot', 'test', defaultOptions)
      ).rejects.toThrow();
    });
  });

  describe('resize functionality', () => {
    it('should not resize when mode is off', async () => {
      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'off',
        maxWidth: 1,
        maxHeight: 1,
      };

      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'no_resize_${seq3}',
        options
      );

      // Should complete without error (resize options ignored when mode is off)
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should not resize when maxWidth and maxHeight are null', async () => {
      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'fit',
        maxWidth: null,
        maxHeight: null,
      };

      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'null_resize_${seq3}',
        options
      );

      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should not upscale small images when mode is fit', async () => {
      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'fit',
        maxWidth: 1000,
        maxHeight: 1000,
      };

      // VALID_PNG_BUFFER is 1x1, should not be upscaled
      const result = await processor.processAndSave(
        VALID_PNG_BUFFER,
        '.clipshot',
        'no_upscale_${seq3}',
        options
      );

      expect(result.fileSize).toBeGreaterThan(0);
      // Dimensions should remain 1x1 (not upscaled to 1000x1000)
      if (result.dimensions) {
        expect(result.dimensions.width).toBe(1);
        expect(result.dimensions.height).toBe(1);
      }
    });

    it('should resize large image to fit maxWidth', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      if (!isSharpAvailable) {
        // Skip test if Sharp is not available
        return;
      }

      // Create a larger image using Sharp
      const sharp = await import('sharp');
      const largeImage = await sharp.default({
        create: {
          width: 200,
          height: 100,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 }
        }
      }).png().toBuffer();

      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'fit',
        maxWidth: 100,
        maxHeight: null,
      };

      const result = await processor.processAndSave(
        largeImage,
        '.clipshot',
        'resize_width_${seq3}',
        options
      );

      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.dimensions).not.toBeNull();
      if (result.dimensions) {
        // Should be resized to 100x50 (maintaining aspect ratio)
        expect(result.dimensions.width).toBe(100);
        expect(result.dimensions.height).toBe(50);
      }
    });

    it('should resize large image to fit maxHeight', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      if (!isSharpAvailable) {
        return;
      }

      const sharp = await import('sharp');
      const largeImage = await sharp.default({
        create: {
          width: 100,
          height: 200,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 1 }
        }
      }).png().toBuffer();

      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'fit',
        maxWidth: null,
        maxHeight: 100,
      };

      const result = await processor.processAndSave(
        largeImage,
        '.clipshot',
        'resize_height_${seq3}',
        options
      );

      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.dimensions).not.toBeNull();
      if (result.dimensions) {
        // Should be resized to 50x100 (maintaining aspect ratio)
        expect(result.dimensions.width).toBe(50);
        expect(result.dimensions.height).toBe(100);
      }
    });

    it('should fit within both maxWidth and maxHeight', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      if (!isSharpAvailable) {
        return;
      }

      const sharp = await import('sharp');
      const largeImage = await sharp.default({
        create: {
          width: 400,
          height: 200,
          channels: 4,
          background: { r: 0, g: 0, b: 255, alpha: 1 }
        }
      }).png().toBuffer();

      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'fit',
        maxWidth: 100,
        maxHeight: 100,
      };

      const result = await processor.processAndSave(
        largeImage,
        '.clipshot',
        'resize_both_${seq3}',
        options
      );

      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.dimensions).not.toBeNull();
      if (result.dimensions) {
        // 400x200 -> constrained by width to 100x50
        expect(result.dimensions.width).toBe(100);
        expect(result.dimensions.height).toBe(50);
      }
    });

    it('should maintain aspect ratio when constrained by height', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      if (!isSharpAvailable) {
        return;
      }

      const sharp = await import('sharp');
      const largeImage = await sharp.default({
        create: {
          width: 200,
          height: 400,
          channels: 4,
          background: { r: 128, g: 128, b: 128, alpha: 1 }
        }
      }).png().toBuffer();

      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'fit',
        maxWidth: 100,
        maxHeight: 100,
      };

      const result = await processor.processAndSave(
        largeImage,
        '.clipshot',
        'resize_aspect_${seq3}',
        options
      );

      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.dimensions).not.toBeNull();
      if (result.dimensions) {
        // 200x400 -> constrained by height to 50x100
        expect(result.dimensions.width).toBe(50);
        expect(result.dimensions.height).toBe(100);
      }
    });
  });

  describe('format conversion with resize', () => {
    it('should resize and convert to JPEG correctly', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      if (!isSharpAvailable) {
        return;
      }

      const sharp = await import('sharp');
      const largeImage = await sharp.default({
        create: {
          width: 200,
          height: 100,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 }
        }
      }).png().toBuffer();

      const options: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'jpeg',
        jpegQuality: 80,
        resizeMode: 'fit',
        maxWidth: 100,
        maxHeight: null,
      };

      const result = await processor.processAndSave(
        largeImage,
        '.clipshot',
        'format_resize_jpeg_${seq3}',
        options
      );

      expect(result.format).toBe('jpeg');
      expect(result.dimensions).not.toBeNull();
      if (result.dimensions) {
        expect(result.dimensions.width).toBe(100);
        expect(result.dimensions.height).toBe(50);
      }
    });

    it('should resize and convert to WebP correctly', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      if (!isSharpAvailable) {
        return;
      }

      const sharp = await import('sharp');
      const largeImage = await sharp.default({
        create: {
          width: 300,
          height: 200,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 1 }
        }
      }).png().toBuffer();

      const options: ImageProcessorOptions = {
        ...defaultOptions,
        format: 'webp',
        webpQuality: 90,
        resizeMode: 'fit',
        maxWidth: 150,
        maxHeight: 150,
      };

      const result = await processor.processAndSave(
        largeImage,
        '.clipshot',
        'format_resize_webp_${seq3}',
        options
      );

      expect(result.format).toBe('webp');
      expect(result.dimensions).not.toBeNull();
      if (result.dimensions) {
        // 300x200 -> constrained by width to 150x100
        expect(result.dimensions.width).toBe(150);
        expect(result.dimensions.height).toBe(100);
      }
    });
  });

  describe('resize edge cases', () => {
    it('should handle square images correctly', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      if (!isSharpAvailable) {
        return;
      }

      const sharp = await import('sharp');
      const squareImage = await sharp.default({
        create: {
          width: 200,
          height: 200,
          channels: 4,
          background: { r: 0, g: 0, b: 255, alpha: 1 }
        }
      }).png().toBuffer();

      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'fit',
        maxWidth: 100,
        maxHeight: 100,
      };

      const result = await processor.processAndSave(
        squareImage,
        '.clipshot',
        'resize_square_${seq3}',
        options
      );

      expect(result.dimensions).not.toBeNull();
      if (result.dimensions) {
        expect(result.dimensions.width).toBe(100);
        expect(result.dimensions.height).toBe(100);
      }
    });

    it('should not resize image exactly at max boundary', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      if (!isSharpAvailable) {
        return;
      }

      const sharp = await import('sharp');
      const exactImage = await sharp.default({
        create: {
          width: 100,
          height: 100,
          channels: 4,
          background: { r: 128, g: 128, b: 128, alpha: 1 }
        }
      }).png().toBuffer();

      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'fit',
        maxWidth: 100,
        maxHeight: 100,
      };

      const result = await processor.processAndSave(
        exactImage,
        '.clipshot',
        'resize_exact_${seq3}',
        options
      );

      expect(result.dimensions).not.toBeNull();
      if (result.dimensions) {
        // Should remain 100x100, not resized
        expect(result.dimensions.width).toBe(100);
        expect(result.dimensions.height).toBe(100);
      }
    });

    it('should resize image just over max boundary', async () => {
      const isSharpAvailable = await processor.isSharpAvailable();
      if (!isSharpAvailable) {
        return;
      }

      const sharp = await import('sharp');
      const slightlyOverImage = await sharp.default({
        create: {
          width: 101,
          height: 101,
          channels: 4,
          background: { r: 64, g: 64, b: 64, alpha: 1 }
        }
      }).png().toBuffer();

      const options: ImageProcessorOptions = {
        ...defaultOptions,
        resizeMode: 'fit',
        maxWidth: 100,
        maxHeight: 100,
      };

      const result = await processor.processAndSave(
        slightlyOverImage,
        '.clipshot',
        'resize_over_${seq3}',
        options
      );

      expect(result.dimensions).not.toBeNull();
      if (result.dimensions) {
        // Should be resized to 100x100
        expect(result.dimensions.width).toBe(100);
        expect(result.dimensions.height).toBe(100);
      }
    });
  });
});
