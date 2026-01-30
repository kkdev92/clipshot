/**
 * Linux clipboard provider
 * Supports both X11 (xclip) and Wayland (wl-paste)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import type { ClipboardData } from '../../core/types';
import { ClipboardError } from '../../core/errors';
import { TIMEOUTS } from '../../core/constants';
import { BaseClipboardProvider } from '../clipboard-provider';
import { getTempFileManager } from '../../security/temp-file-manager';
import { escapeShellArg } from '../../security/sanitizer';

const execAsync = promisify(exec);

/**
 * Detect display server type
 */
type DisplayServer = 'x11' | 'wayland' | 'unknown';

/**
 * Linux clipboard provider
 * Automatically detects and uses appropriate tool (xclip or wl-paste)
 */
export class LinuxClipboardProvider extends BaseClipboardProvider {
  private readonly tempFileManager = getTempFileManager();
  private currentTempFile: string | null = null;
  private displayServer: DisplayServer | null = null;
  private availableTool: 'xclip' | 'wl-paste' | null = null;

  constructor() {
    super('linux');
  }

  async isAvailable(): Promise<boolean> {
    await this.detectEnvironment();
    return this.availableTool !== null;
  }

  private async detectEnvironment(): Promise<void> {
    if (this.displayServer !== null) {
      return; // Already detected
    }

    // Detect display server
    const xdgSessionType = process.env['XDG_SESSION_TYPE'];
    const waylandDisplay = process.env['WAYLAND_DISPLAY'];
    const display = process.env['DISPLAY'];

    if ((waylandDisplay !== undefined && waylandDisplay !== '') || xdgSessionType === 'wayland') {
      this.displayServer = 'wayland';
    } else if ((display !== undefined && display !== '') || xdgSessionType === 'x11') {
      this.displayServer = 'x11';
    } else {
      this.displayServer = 'unknown';
    }

    // Check for available tools
    if (this.displayServer === 'wayland' || this.displayServer === 'unknown') {
      if (await this.isToolAvailable('wl-paste')) {
        this.availableTool = 'wl-paste';
        return;
      }
    }

    if (this.displayServer === 'x11' || this.displayServer === 'unknown') {
      if (await this.isToolAvailable('xclip')) {
        this.availableTool = 'xclip';
        return;
      }
    }

    // Try both as fallback
    if (await this.isToolAvailable('wl-paste')) {
      this.availableTool = 'wl-paste';
    } else if (await this.isToolAvailable('xclip')) {
      this.availableTool = 'xclip';
    }
  }

  private async isToolAvailable(tool: string): Promise<boolean> {
    try {
      await execAsync(`which ${tool}`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async hasImage(): Promise<boolean> {
    await this.detectEnvironment();

    if (!this.availableTool) {
      return false;
    }

    try {
      if (this.availableTool === 'wl-paste') {
        // Check if clipboard has image
        const { stdout } = await execAsync('wl-paste --list-types 2>/dev/null || true', {
          timeout: TIMEOUTS.CLIPBOARD_READ,
        });
        return stdout.includes('image/png') || stdout.includes('image/jpeg');
      } else {
        // xclip - check targets
        const { stdout } = await execAsync(
          'xclip -selection clipboard -t TARGETS -o 2>/dev/null || true',
          { timeout: TIMEOUTS.CLIPBOARD_READ }
        );
        return stdout.includes('image/png') || stdout.includes('image/jpeg');
      }
    } catch {
      return false;
    }
  }

  async getImageData(): Promise<ClipboardData> {
    await this.detectEnvironment();

    // Clean up previous temp file if any
    await this.cleanup();

    if (!this.availableTool) {
      throw new ClipboardError('No clipboard tool available (install xclip or wl-clipboard)');
    }

    // Create a new temp file for this operation
    this.currentTempFile = await this.tempFileManager.createSecureTempFile('.png');

    try {
      const hasImage = await this.hasImage();
      const hasText = await this.hasText();

      if (!hasImage) {
        return {
          hasImage: false,
          hasText,
          imageBuffer: null,
          format: null,
        };
      }

      const buffer = await this.saveClipboardImage();

      if (!buffer) {
        return {
          hasImage: false,
          hasText,
          imageBuffer: null,
          format: null,
        };
      }

      const format = this.detectImageFormat(buffer);

      return {
        hasImage: true,
        hasText,
        imageBuffer: buffer,
        format,
      };
    } catch (error) {
      await this.cleanup();
      throw new ClipboardError(
        `Failed to read clipboard: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async hasText(): Promise<boolean> {
    if (!this.availableTool) {
      return false;
    }

    try {
      if (this.availableTool === 'wl-paste') {
        const { stdout } = await execAsync('wl-paste --list-types 2>/dev/null || true', {
          timeout: TIMEOUTS.CLIPBOARD_READ,
        });
        return stdout.includes('text/plain') || stdout.includes('UTF8_STRING');
      } else {
        const { stdout } = await execAsync(
          'xclip -selection clipboard -t TARGETS -o 2>/dev/null || true',
          { timeout: TIMEOUTS.CLIPBOARD_READ }
        );
        return stdout.includes('text/plain') || stdout.includes('UTF8_STRING');
      }
    } catch {
      return false;
    }
  }

  private async saveClipboardImage(): Promise<Buffer | null> {
    if (this.currentTempFile === null || this.currentTempFile === '' || this.availableTool === null) {
      return null;
    }

    try {
      if (this.availableTool === 'wl-paste') {
        // Try PNG first, then JPEG
        try {
          await execAsync(
            `wl-paste --type image/png > ${escapeShellArg(this.currentTempFile)}`,
            { timeout: TIMEOUTS.CLIPBOARD_READ }
          );
        } catch {
          await execAsync(
            `wl-paste --type image/jpeg > ${escapeShellArg(this.currentTempFile)}`,
            { timeout: TIMEOUTS.CLIPBOARD_READ }
          );
        }
      } else {
        // xclip - try PNG first, then JPEG
        try {
          await execAsync(
            `xclip -selection clipboard -t image/png -o > ${escapeShellArg(this.currentTempFile)}`,
            { timeout: TIMEOUTS.CLIPBOARD_READ }
          );
        } catch {
          await execAsync(
            `xclip -selection clipboard -t image/jpeg -o > ${escapeShellArg(this.currentTempFile)}`,
            { timeout: TIMEOUTS.CLIPBOARD_READ }
          );
        }
      }

      // Verify file was created and has content
      const stats = await fs.stat(this.currentTempFile);
      if (stats.size === 0) {
        return null;
      }

      return await fs.readFile(this.currentTempFile);
    } catch {
      return null;
    }
  }

  async cleanup(): Promise<void> {
    if (this.currentTempFile !== null && this.currentTempFile !== '') {
      await this.tempFileManager.cleanup(this.currentTempFile);
      this.currentTempFile = null;
    }
  }

  /**
   * Get the detected display server
   */
  getDisplayServer(): DisplayServer {
    return this.displayServer ?? 'unknown';
  }

  /**
   * Get the clipboard tool being used
   */
  getClipboardTool(): string | null {
    return this.availableTool;
  }
}
