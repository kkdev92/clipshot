import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClipboardManager, createClipboardProvider } from '../../src/clipboard/clipboard-manager';
import type { IClipboardProvider } from '../../src/clipboard/clipboard-provider';
import type { ClipboardData } from '../../src/core/types';

// Mock provider for testing
class MockClipboardProvider implements IClipboardProvider {
  private imageAvailable = false;
  private imageBuffer: Buffer | null = null;

  setImageAvailable(available: boolean, buffer?: Buffer): void {
    this.imageAvailable = available;
    this.imageBuffer = buffer ?? null;
  }

  async hasImage(): Promise<boolean> {
    return this.imageAvailable;
  }

  async getImageData(): Promise<ClipboardData> {
    return {
      hasImage: this.imageAvailable,
      hasText: false,
      imageBuffer: this.imageBuffer,
      format: this.imageBuffer ? 'png' : null,
    };
  }

  async cleanup(): Promise<void> {
    // No-op for mock
  }

  getPlatform(): string {
    return 'mock';
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

describe('ClipboardManager', () => {
  let mockProvider: MockClipboardProvider;
  let manager: ClipboardManager;

  beforeEach(() => {
    mockProvider = new MockClipboardProvider();
    manager = new ClipboardManager(mockProvider);
  });

  describe('isAvailable', () => {
    it('should return true when provider is available', async () => {
      const result = await manager.isAvailable();
      expect(result).toBe(true);
    });

    it('should return false when provider throws', async () => {
      vi.spyOn(mockProvider, 'isAvailable').mockRejectedValue(new Error('Not available'));
      const result = await manager.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('hasImage', () => {
    it('should return false when no image in clipboard', async () => {
      mockProvider.setImageAvailable(false);
      const result = await manager.hasImage();
      expect(result).toBe(false);
    });

    it('should return true when image is in clipboard', async () => {
      mockProvider.setImageAvailable(true);
      const result = await manager.hasImage();
      expect(result).toBe(true);
    });

    it('should return false when provider throws', async () => {
      vi.spyOn(mockProvider, 'hasImage').mockRejectedValue(new Error('Error'));
      const result = await manager.hasImage();
      expect(result).toBe(false);
    });
  });

  describe('getImageData', () => {
    it('should return clipboard data with image', async () => {
      const testBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG signature
      mockProvider.setImageAvailable(true, testBuffer);

      const result = await manager.getImageData();
      expect(result.hasImage).toBe(true);
      expect(result.imageBuffer).toEqual(testBuffer);
    });

    it('should return empty data when no image', async () => {
      mockProvider.setImageAvailable(false);

      const result = await manager.getImageData();
      expect(result.hasImage).toBe(false);
      expect(result.imageBuffer).toBeNull();
    });

    it('should throw when provider is not available', async () => {
      vi.spyOn(mockProvider, 'isAvailable').mockResolvedValue(false);

      await expect(manager.getImageData()).rejects.toThrow('Clipboard provider not available');
    });
  });

  describe('cleanup', () => {
    it('should call provider cleanup', async () => {
      const cleanupSpy = vi.spyOn(mockProvider, 'cleanup');
      await manager.cleanup();
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });

  describe('getPlatform', () => {
    it('should return platform identifier', () => {
      // Platform depends on OS, just verify it returns a string
      const platform = manager.getPlatform();
      expect(typeof platform).toBe('string');
    });
  });

  describe('getProviderName', () => {
    it('should return provider name', () => {
      const name = manager.getProviderName();
      expect(name).toBe('mock');
    });
  });
});

describe('createClipboardProvider', () => {
  it('should create a provider without throwing', () => {
    // This test verifies the factory function works on the current platform
    expect(() => createClipboardProvider()).not.toThrow();
  });
});
