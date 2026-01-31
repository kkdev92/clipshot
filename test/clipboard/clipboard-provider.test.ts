/**
 * Tests for BaseClipboardProvider abstract class
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ClipboardData } from '../../src/core/types';
import { BaseClipboardProvider } from '../../src/clipboard/clipboard-provider';
import { VALID_PNG_BUFFER, VALID_JPEG_BUFFER } from '../helpers/image-fixtures';

/**
 * Concrete implementation for testing
 */
class TestClipboardProvider extends BaseClipboardProvider {
  constructor() {
    super('test');
  }

  async hasImage(): Promise<boolean> {
    return false;
  }

  async getImageData(): Promise<ClipboardData> {
    return this.createEmptyClipboardData();
  }

  async cleanup(): Promise<void> {
    // No-op
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  // Expose protected methods for testing
  public testDetectImageFormat(buffer: Buffer): 'png' | 'jpeg' | null {
    return this.detectImageFormat(buffer);
  }

  public testCreateEmptyClipboardData(): ClipboardData {
    return this.createEmptyClipboardData();
  }
}

describe('BaseClipboardProvider', () => {
  let provider: TestClipboardProvider;

  beforeEach(() => {
    provider = new TestClipboardProvider();
  });

  describe('getPlatform', () => {
    it('should return the platform name', () => {
      expect(provider.getPlatform()).toBe('test');
    });
  });

  describe('createEmptyClipboardData', () => {
    it('should return empty clipboard data object', () => {
      const result = provider.testCreateEmptyClipboardData();

      expect(result.hasImage).toBe(false);
      expect(result.hasText).toBe(false);
      expect(result.imageBuffer).toBeNull();
      expect(result.format).toBeNull();
    });
  });

  describe('detectImageFormat', () => {
    it('should detect PNG format from buffer', () => {
      const result = provider.testDetectImageFormat(VALID_PNG_BUFFER);
      expect(result).toBe('png');
    });

    it('should detect JPEG format from buffer', () => {
      const result = provider.testDetectImageFormat(VALID_JPEG_BUFFER);
      expect(result).toBe('jpeg');
    });

    it('should return null for buffer too short', () => {
      const shortBuffer = Buffer.from([0x89, 0x50]);
      const result = provider.testDetectImageFormat(shortBuffer);
      expect(result).toBeNull();
    });

    it('should return null for unknown format', () => {
      const unknownBuffer = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
      const result = provider.testDetectImageFormat(unknownBuffer);
      expect(result).toBeNull();
    });

    it('should return null for GIF (not supported)', () => {
      const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
      const result = provider.testDetectImageFormat(gifBuffer);
      expect(result).toBeNull();
    });

    it('should return null for BMP (not supported)', () => {
      const bmpBuffer = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const result = provider.testDetectImageFormat(bmpBuffer);
      expect(result).toBeNull();
    });

    it('should return null for empty buffer', () => {
      const emptyBuffer = Buffer.alloc(0);
      const result = provider.testDetectImageFormat(emptyBuffer);
      expect(result).toBeNull();
    });
  });

  describe('abstract method implementations', () => {
    it('should implement hasImage', async () => {
      const result = await provider.hasImage();
      expect(typeof result).toBe('boolean');
    });

    it('should implement getImageData', async () => {
      const result = await provider.getImageData();
      expect(result).toHaveProperty('hasImage');
      expect(result).toHaveProperty('hasText');
      expect(result).toHaveProperty('imageBuffer');
      expect(result).toHaveProperty('format');
    });

    it('should implement cleanup', async () => {
      await expect(provider.cleanup()).resolves.not.toThrow();
    });

    it('should implement isAvailable', async () => {
      const result = await provider.isAvailable();
      expect(typeof result).toBe('boolean');
    });
  });
});

describe('IClipboardProvider interface', () => {
  it('should be implemented by TestClipboardProvider', () => {
    const provider = new TestClipboardProvider();

    // All interface methods should exist
    expect(typeof provider.hasImage).toBe('function');
    expect(typeof provider.getImageData).toBe('function');
    expect(typeof provider.cleanup).toBe('function');
    expect(typeof provider.getPlatform).toBe('function');
    expect(typeof provider.isAvailable).toBe('function');
  });
});
