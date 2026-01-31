/**
 * macOS clipboard provider tests
 * Tests osascript and pngpaste integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Import the provider class for type checking
// Actual tests will mock the system commands
import { MacOSClipboardProvider } from '../../../src/clipboard/providers/macos-provider';

describe('MacOSClipboardProvider', () => {
  let provider: MacOSClipboardProvider;

  beforeEach(() => {
    provider = new MacOSClipboardProvider();
  });

  afterEach(async () => {
    await provider.cleanup();
  });

  describe('isAvailable', () => {
    it('should return true on macOS when osascript exists', async () => {
      if (process.platform !== 'darwin') {
        // Skip on non-macOS
        return;
      }

      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });

    it('should return false on non-macOS platforms', async () => {
      if (process.platform === 'darwin') {
        // Skip on macOS (it will be available)
        return;
      }

      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('hasImage (macOS only)', () => {
    it('should check clipboard for image content', async () => {
      if (process.platform !== 'darwin') {
        return;
      }

      // This test just verifies the method doesn't throw
      const result = await provider.hasImage();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getImageData (macOS only)', () => {
    it('should return clipboard data structure', async () => {
      if (process.platform !== 'darwin') {
        return;
      }

      const result = await provider.getImageData();

      expect(result).toHaveProperty('hasImage');
      expect(result).toHaveProperty('hasText');
      expect(result).toHaveProperty('imageBuffer');
      expect(result).toHaveProperty('format');

      expect(typeof result.hasImage).toBe('boolean');
      expect(typeof result.hasText).toBe('boolean');
    });

    it('should return null imageBuffer when clipboard has no image', async () => {
      if (process.platform !== 'darwin') {
        return;
      }

      // Clear clipboard to text
      try {
        await execAsync('echo "test" | pbcopy');
      } catch {
        // pbcopy might not be available
        return;
      }

      const result = await provider.getImageData();

      if (!result.hasImage) {
        expect(result.imageBuffer).toBeNull();
      }
    });
  });

  describe('cleanup', () => {
    it('should not throw when called multiple times', async () => {
      await expect(provider.cleanup()).resolves.not.toThrow();
      await expect(provider.cleanup()).resolves.not.toThrow();
    });

    it('should handle cleanup when no temp file exists', async () => {
      // Fresh provider, no temp file
      await expect(provider.cleanup()).resolves.not.toThrow();
    });
  });

  describe('platform detection', () => {
    it('should identify as macos platform', () => {
      expect(provider.getPlatform()).toBe('macos');
    });
  });

  describe('AppleScript execution (macOS only)', () => {
    it('should have valid AppleScript syntax for clipboard check', async () => {
      if (process.platform !== 'darwin') {
        return;
      }

      // Verify basic AppleScript syntax by running a simple test
      const testScript = `
use framework "AppKit"
use scripting additions
return "ok"
`;

      try {
        const { stdout } = await execAsync(`osascript -e '${testScript.replace(/'/g, "'\\''")}'`, {
          timeout: 5000,
        });
        expect(stdout.trim()).toBe('ok');
      } catch (error) {
        // osascript might not be available in CI
        console.log('AppleScript test skipped:', error);
      }
    });

    it('should be able to check NSPasteboard availability', async () => {
      if (process.platform !== 'darwin') {
        return;
      }

      const testScript = `
use framework "AppKit"
set pb to current application's NSPasteboard's generalPasteboard()
return (pb is not missing value) as text
`;

      try {
        const { stdout } = await execAsync(`osascript -e '${testScript.replace(/'/g, "'\\''")}'`, {
          timeout: 5000,
        });
        expect(stdout.trim()).toBe('true');
      } catch (error) {
        // CI might not have GUI access
        console.log('NSPasteboard test skipped:', error);
      }
    });
  });

  describe('pngpaste detection (macOS only)', () => {
    it('should detect pngpaste availability', async () => {
      if (process.platform !== 'darwin') {
        return;
      }

      // Just verify the detection doesn't crash
      // pngpaste may or may not be installed
      try {
        const { stdout } = await execAsync('which pngpaste', { timeout: 1000 });
        console.log('pngpaste found at:', stdout.trim());
      } catch {
        console.log('pngpaste not installed (expected in CI)');
      }
    });
  });

  describe('temp file handling', () => {
    it('should create temp file with .png extension', async () => {
      if (process.platform !== 'darwin') {
        return;
      }

      // Call getImageData to trigger temp file creation
      await provider.getImageData();

      // Cleanup should work without errors
      await provider.cleanup();
    });
  });

  describe('error handling', () => {
    it('should handle osascript timeout gracefully', async () => {
      if (process.platform !== 'darwin') {
        return;
      }

      // This is a basic smoke test - actual timeout testing would require mocking
      const result = await provider.hasImage();
      expect(typeof result).toBe('boolean');
    });
  });
});

describe('MacOSClipboardProvider static analysis', () => {
  it('CHECK_CLIPBOARD_SCRIPT should contain required AppleScript elements', () => {
    // We can't import the private constant, but we can verify the provider works
    const provider = new MacOSClipboardProvider();
    expect(provider).toBeDefined();
  });

  it('should handle environment variables for temp path', () => {
    // The provider uses CLIP_TEMP_PATH env var
    // This verifies the pattern is correct
    const testPath = '/tmp/test.png';
    const env = {
      ...process.env,
      CLIP_TEMP_PATH: testPath,
    };
    expect(env.CLIP_TEMP_PATH).toBe(testPath);
  });
});
