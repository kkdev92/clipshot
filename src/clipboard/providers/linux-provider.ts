/**
 * Linux clipboard provider
 * Supports both X11 (xclip) and Wayland (wl-paste)
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import type { ClipboardData } from '../../core/types';
import { ClipboardError } from '../../core/errors';
import { TIMEOUTS, LIMITS } from '../../core/constants';
import { BaseClipboardProvider } from '../clipboard-provider';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Upper bound for image data read from the clipboard via stdout
const MAX_CLIPBOARD_BYTES = LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Detect display server type
 */
type DisplayServer = 'x11' | 'wayland' | 'unknown';

/**
 * Linux clipboard provider
 * Automatically detects and uses appropriate tool (xclip or wl-paste)
 *
 * The clipboard is read in two process spawns per paste: one to list the
 * offered MIME types (answers "has image?", "has text?" and selects the
 * format to request) and one to read the image bytes straight from stdout.
 * No temp files and no shell redirection are involved.
 */
export class LinuxClipboardProvider extends BaseClipboardProvider {
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

  /**
   * List the MIME types currently offered by the clipboard.
   * One process spawn answers image presence, text presence, and which
   * image format to request.
   */
  private async listClipboardTypes(): Promise<string> {
    if (!this.availableTool) {
      return '';
    }

    try {
      if (this.availableTool === 'wl-paste') {
        const { stdout } = await execAsync('wl-paste --list-types 2>/dev/null || true', {
          timeout: TIMEOUTS.CLIPBOARD_READ,
        });
        return stdout;
      }
      const { stdout } = await execAsync(
        'xclip -selection clipboard -t TARGETS -o 2>/dev/null || true',
        { timeout: TIMEOUTS.CLIPBOARD_READ }
      );
      return stdout;
    } catch {
      return '';
    }
  }

  private static hasImageType(types: string): 'image/png' | 'image/jpeg' | null {
    if (types.includes('image/png')) {
      return 'image/png';
    }
    if (types.includes('image/jpeg')) {
      return 'image/jpeg';
    }
    return null;
  }

  private static hasTextType(types: string): boolean {
    return types.includes('text/plain') || types.includes('UTF8_STRING');
  }

  async hasImage(): Promise<boolean> {
    await this.detectEnvironment();

    if (!this.availableTool) {
      return false;
    }

    return LinuxClipboardProvider.hasImageType(await this.listClipboardTypes()) !== null;
  }

  async getImageData(): Promise<ClipboardData> {
    await this.detectEnvironment();

    if (!this.availableTool) {
      throw new ClipboardError('No clipboard tool available (install xclip or wl-clipboard)');
    }

    try {
      const types = await this.listClipboardTypes();
      const hasText = LinuxClipboardProvider.hasTextType(types);
      const imageType = LinuxClipboardProvider.hasImageType(types);

      if (imageType === null) {
        return {
          hasImage: false,
          hasText,
          imageBuffer: null,
          format: null,
        };
      }

      const buffer = await this.readClipboardImage(imageType);

      if (!buffer || buffer.length === 0) {
        return {
          hasImage: false,
          hasText,
          imageBuffer: null,
          format: null,
        };
      }

      return {
        hasImage: true,
        hasText,
        imageBuffer: buffer,
        format: this.detectImageFormat(buffer),
      };
    } catch (error) {
      throw new ClipboardError(
        `Failed to read clipboard: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Read the clipboard image of the given MIME type directly from the
   * tool's stdout. execFile with a buffer encoding avoids both the shell
   * (no escaping concerns) and the temp-file round-trip.
   */
  private async readClipboardImage(mimeType: string): Promise<Buffer | null> {
    if (this.availableTool === null) {
      return null;
    }

    const [file, args] =
      this.availableTool === 'wl-paste'
        ? (['wl-paste', ['--type', mimeType]] as const)
        : (['xclip', ['-selection', 'clipboard', '-t', mimeType, '-o']] as const);

    try {
      const { stdout } = await execFileAsync(file, [...args], {
        timeout: TIMEOUTS.CLIPBOARD_READ,
        encoding: 'buffer',
        maxBuffer: MAX_CLIPBOARD_BYTES,
      });
      return stdout;
    } catch {
      return null;
    }
  }

  async cleanup(): Promise<void> {
    // Clipboard data is read from stdout — no temp files to clean up
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
