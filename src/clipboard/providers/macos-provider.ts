/**
 * macOS clipboard provider
 * Uses osascript and NSPasteboard for clipboard access
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
 * AppleScript to check clipboard contents and save image
 */
const CHECK_CLIPBOARD_SCRIPT = `
use framework "AppKit"
use scripting additions

set hasImage to false
set hasText to false
set savedPath to ""

try
    set pb to current application's NSPasteboard's generalPasteboard()

    -- Check for text
    set textTypes to {"public.utf8-plain-text", "public.plain-text"}
    repeat with textType in textTypes
        if (pb's canReadItemWithDataConformingToTypes:{textType}) then
            set hasText to true
            exit repeat
        end if
    end repeat

    -- Check for image types
    set imageTypes to {"public.png", "public.tiff", "public.jpeg"}
    repeat with imageType in imageTypes
        if (pb's canReadItemWithDataConformingToTypes:{imageType}) then
            set hasImage to true
            exit repeat
        end if
    end repeat

end try

return (hasImage as text) & "," & (hasText as text)
`;

/**
 * macOS clipboard provider using osascript
 */
export class MacOSClipboardProvider extends BaseClipboardProvider {
  private readonly tempFileManager = getTempFileManager();
  private currentTempFile: string | null = null;

  constructor() {
    super('macos');
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which osascript', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async hasImage(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `osascript -e ${escapeShellArg(CHECK_CLIPBOARD_SCRIPT)}`,
        { timeout: TIMEOUTS.CLIPBOARD_READ }
      );
      const [hasImage] = stdout.trim().split(',');
      return hasImage === 'true';
    } catch {
      return false;
    }
  }

  async getImageData(): Promise<ClipboardData> {
    // Clean up previous temp file if any
    await this.cleanup();

    // Create a new temp file for this operation
    this.currentTempFile = await this.tempFileManager.createSecureTempFile('.png');

    try {
      // First check what's in clipboard
      const { stdout: checkResult } = await execAsync(
        `osascript -e ${escapeShellArg(CHECK_CLIPBOARD_SCRIPT)}`,
        { timeout: TIMEOUTS.CLIPBOARD_READ }
      );

      const [hasImageStr, hasTextStr] = checkResult.trim().split(',');
      const hasImage = hasImageStr === 'true';
      const hasText = hasTextStr === 'true';

      if (!hasImage) {
        return {
          hasImage: false,
          hasText,
          imageBuffer: null,
          format: null,
        };
      }

      // Save the image using pngpaste or screencapture
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

  private async saveClipboardImage(): Promise<Buffer | null> {
    if (this.currentTempFile === null || this.currentTempFile === '') {
      return null;
    }

    // Try pngpaste first (if installed via Homebrew)
    try {
      await execAsync(`pngpaste ${escapeShellArg(this.currentTempFile)}`, {
        timeout: TIMEOUTS.CLIPBOARD_READ,
      });
      return await fs.readFile(this.currentTempFile);
    } catch {
      // pngpaste not available, use osascript
    }

    // Use osascript with NSPasteboard
    // Path is passed via environment variable to prevent injection attacks
    const saveScript = `
use framework "AppKit"
use framework "Foundation"
use scripting additions

set tempPath to (system attribute "CLIP_TEMP_PATH")
set pb to current application's NSPasteboard's generalPasteboard()
set imageTypes to {"public.png", "public.tiff", "public.jpeg"}

repeat with imageType in imageTypes
    set imgData to pb's dataForType:imageType
    if imgData is not missing value then
        set nsImage to current application's NSImage's alloc()'s initWithData:imgData
        if nsImage is not missing value then
            set tiffData to nsImage's TIFFRepresentation()
            set bitmap to current application's NSBitmapImageRep's imageRepWithData:tiffData
            set pngData to bitmap's representationUsingType:(current application's NSPNGFileType) properties:(missing value)
            pngData's writeToFile:tempPath atomically:true
            return "success"
        end if
    end if
end repeat

return "failed"
`;

    try {
      const { stdout } = await execAsync(
        `osascript -e ${escapeShellArg(saveScript)}`,
        {
          timeout: TIMEOUTS.CLIPBOARD_READ,
          env: {
            ...process.env,
            CLIP_TEMP_PATH: this.currentTempFile,
          },
        }
      );

      if (stdout.trim() === 'success') {
        return await fs.readFile(this.currentTempFile);
      }
    } catch {
      // Failed to save
    }

    return null;
  }

  async cleanup(): Promise<void> {
    if (this.currentTempFile !== null && this.currentTempFile !== '') {
      await this.tempFileManager.cleanup(this.currentTempFile);
      this.currentTempFile = null;
    }
  }
}
