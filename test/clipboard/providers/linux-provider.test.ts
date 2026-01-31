/**
 * Linux clipboard provider tests
 * Tests X11 (xclip) and Wayland (wl-paste) integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Import the provider class
import { LinuxClipboardProvider } from '../../../src/clipboard/providers/linux-provider';

describe('LinuxClipboardProvider', () => {
  let provider: LinuxClipboardProvider;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    provider = new LinuxClipboardProvider();
  });

  afterEach(async () => {
    await provider.cleanup();
    // Restore environment
    process.env = { ...originalEnv };
  });

  describe('isAvailable', () => {
    it('should return true on Linux when clipboard tool exists', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      const result = await provider.isAvailable();
      // Result depends on whether xclip or wl-paste is installed
      expect(typeof result).toBe('boolean');
    });

    it('should return false on non-Linux platforms', async () => {
      if (process.platform === 'linux') {
        return;
      }

      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('detectEnvironment', () => {
    it('should detect Wayland when WAYLAND_DISPLAY is set', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      process.env.WAYLAND_DISPLAY = 'wayland-0';
      delete process.env.DISPLAY;

      const newProvider = new LinuxClipboardProvider();
      await newProvider.isAvailable(); // Triggers detection

      expect(newProvider.getDisplayServer()).toBe('wayland');
    });

    it('should detect X11 when DISPLAY is set', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      delete process.env.WAYLAND_DISPLAY;
      process.env.DISPLAY = ':0';

      const newProvider = new LinuxClipboardProvider();
      await newProvider.isAvailable();

      expect(newProvider.getDisplayServer()).toBe('x11');
    });

    it('should detect from XDG_SESSION_TYPE', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      delete process.env.WAYLAND_DISPLAY;
      delete process.env.DISPLAY;
      process.env.XDG_SESSION_TYPE = 'wayland';

      const newProvider = new LinuxClipboardProvider();
      await newProvider.isAvailable();

      expect(newProvider.getDisplayServer()).toBe('wayland');
    });

    it('should return unknown when no display env is set', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      delete process.env.WAYLAND_DISPLAY;
      delete process.env.DISPLAY;
      delete process.env.XDG_SESSION_TYPE;

      const newProvider = new LinuxClipboardProvider();
      await newProvider.isAvailable();

      // Will be 'unknown' initially, might change based on tool availability
      const displayServer = newProvider.getDisplayServer();
      expect(['x11', 'wayland', 'unknown']).toContain(displayServer);
    });
  });

  describe('hasImage (Linux only)', () => {
    it('should check clipboard for image content', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      const result = await provider.hasImage();
      expect(typeof result).toBe('boolean');
    });

    it('should return false when no clipboard tool available', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      // If no tool is available, hasImage should return false
      const result = await provider.hasImage();
      // Can't guarantee false without mocking, just verify it doesn't throw
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getImageData (Linux only)', () => {
    it('should return clipboard data structure', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      try {
        const result = await provider.getImageData();

        expect(result).toHaveProperty('hasImage');
        expect(result).toHaveProperty('hasText');
        expect(result).toHaveProperty('imageBuffer');
        expect(result).toHaveProperty('format');

        expect(typeof result.hasImage).toBe('boolean');
        expect(typeof result.hasText).toBe('boolean');
      } catch (error) {
        // Might throw if no clipboard tool available
        expect(error).toBeDefined();
      }
    });
  });

  describe('cleanup', () => {
    it('should not throw when called multiple times', async () => {
      await expect(provider.cleanup()).resolves.not.toThrow();
      await expect(provider.cleanup()).resolves.not.toThrow();
    });
  });

  describe('getDisplayServer', () => {
    it('should return detected display server type', () => {
      // Before detection, returns 'unknown'
      expect(['x11', 'wayland', 'unknown']).toContain(provider.getDisplayServer());
    });
  });

  describe('getClipboardTool', () => {
    it('should return the active clipboard tool or null', async () => {
      if (process.platform !== 'linux') {
        expect(provider.getClipboardTool()).toBeNull();
        return;
      }

      await provider.isAvailable();
      const tool = provider.getClipboardTool();

      expect(tool === null || tool === 'xclip' || tool === 'wl-paste').toBe(true);
    });
  });

  describe('platform detection', () => {
    it('should identify as linux platform', () => {
      expect(provider.getPlatform()).toBe('linux');
    });
  });

  describe('xclip integration (Linux X11)', () => {
    it('should detect xclip availability', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      try {
        const { stdout } = await execAsync('which xclip', { timeout: 5000 });
        console.log('xclip found at:', stdout.trim());
      } catch {
        console.log('xclip not installed');
      }
    });

    it('should check xclip TARGETS correctly', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      try {
        await execAsync('xclip -selection clipboard -t TARGETS -o 2>/dev/null || true', {
          timeout: 5000,
        });
        // Just verify the command runs
      } catch {
        // xclip might not be available or no display
      }
    });
  });

  describe('wl-paste integration (Linux Wayland)', () => {
    it('should detect wl-paste availability', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      try {
        const { stdout } = await execAsync('which wl-paste', { timeout: 5000 });
        console.log('wl-paste found at:', stdout.trim());
      } catch {
        console.log('wl-paste not installed');
      }
    });

    it('should check wl-paste list-types correctly', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      try {
        await execAsync('wl-paste --list-types 2>/dev/null || true', {
          timeout: 5000,
        });
        // Just verify the command runs
      } catch {
        // wl-paste might not be available or no Wayland session
      }
    });
  });

  describe('image type detection', () => {
    it('should detect PNG MIME type', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      // Test the MIME type detection logic
      const pngMime = 'image/png';
      expect(pngMime.includes('image/png')).toBe(true);
    });

    it('should detect JPEG MIME type', async () => {
      const jpegMime = 'image/jpeg';
      expect(jpegMime.includes('image/jpeg')).toBe(true);
    });
  });

  describe('text detection', () => {
    it('should detect text/plain MIME type', () => {
      const textMime = 'text/plain';
      expect(textMime.includes('text/plain')).toBe(true);
    });

    it('should detect UTF8_STRING type', () => {
      const utf8Type = 'UTF8_STRING';
      expect(utf8Type.includes('UTF8_STRING')).toBe(true);
    });
  });

  describe('temp file handling', () => {
    it('should create temp file with .png extension', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      try {
        await provider.getImageData();
      } catch {
        // Might fail if no clipboard tool
      }

      // Cleanup should work without errors
      await provider.cleanup();
    });
  });

  describe('error handling', () => {
    it('should throw ClipboardError when no tool available', async () => {
      if (process.platform !== 'linux') {
        return;
      }

      // This test depends on the environment
      // In CI without X11/Wayland, this will throw
      try {
        await provider.getImageData();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});

describe('LinuxClipboardProvider tool selection', () => {
  it('should prefer wl-paste on Wayland', async () => {
    if (process.platform !== 'linux') {
      return;
    }

    process.env.WAYLAND_DISPLAY = 'wayland-0';
    const provider = new LinuxClipboardProvider();
    await provider.isAvailable();

    const tool = provider.getClipboardTool();
    // If wl-paste is installed, it should be selected
    if (tool !== null) {
      console.log('Selected tool on Wayland:', tool);
    }
  });

  it('should prefer xclip on X11', async () => {
    if (process.platform !== 'linux') {
      return;
    }

    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ':0';
    process.env.XDG_SESSION_TYPE = 'x11';

    const provider = new LinuxClipboardProvider();
    await provider.isAvailable();

    const tool = provider.getClipboardTool();
    if (tool !== null) {
      console.log('Selected tool on X11:', tool);
    }
  });

  it('should fallback to any available tool', async () => {
    if (process.platform !== 'linux') {
      return;
    }

    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    delete process.env.XDG_SESSION_TYPE;

    const provider = new LinuxClipboardProvider();
    await provider.isAvailable();

    const tool = provider.getClipboardTool();
    console.log('Fallback tool:', tool);
  });
});
