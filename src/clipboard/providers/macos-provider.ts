/**
 * macOS clipboard provider
 * Uses pngpaste (when installed) or osascript/NSPasteboard for clipboard access
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import type { ClipboardData } from '../../core/types';
import { ClipboardError } from '../../core/errors';
import { TIMEOUTS, LIMITS } from '../../core/constants';
import { BaseClipboardProvider } from '../clipboard-provider';
import { getTempFileManager } from '../../security/temp-file-manager';
import { escapeShellArg } from '../../security/sanitizer';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Upper bound for image data read from the clipboard via stdout
const MAX_CLIPBOARD_BYTES = LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024;

// Cache pngpaste availability to avoid repeated checks
let pngpasteAvailable: boolean | null = null;

/**
 * AppleScript to check clipboard contents and save image
 */
const CHECK_CLIPBOARD_SCRIPT = `
use framework "AppKit"
use scripting additions

set hasImage to false
set hasText to false

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
 * AppleScript that checks the clipboard AND saves any image in one
 * invocation. osascript startup (with AppKit loading) costs hundreds of
 * milliseconds, so combining the old separate check + save scripts halves
 * the per-paste cost.
 *
 * Raw PNG/JPEG clipboard bytes are written as-is — no NSImage decode and
 * PNG re-encode (Sharp normalizes the format later). TIFF (the only type
 * some apps provide) is converted to PNG since downstream fallback paths
 * don't read TIFF.
 *
 * Output: "saved,<hasText>" | "none,<hasText>"
 * The temp path is passed via environment variable to prevent injection.
 */
const GET_CLIPBOARD_IMAGE_SCRIPT = `
use framework "AppKit"
use framework "Foundation"
use scripting additions

set tempPath to (system attribute "CLIP_TEMP_PATH")
set pb to current application's NSPasteboard's generalPasteboard()

set hasText to false
try
    set textTypes to {"public.utf8-plain-text", "public.plain-text"}
    repeat with textType in textTypes
        if (pb's canReadItemWithDataConformingToTypes:{textType}) then
            set hasText to true
            exit repeat
        end if
    end repeat
end try

try
    -- Write raw bytes for natively encoded formats (no re-encode)
    repeat with imageType in {"public.png", "public.jpeg"}
        set imgData to pb's dataForType:imageType
        if imgData is not missing value then
            imgData's writeToFile:tempPath atomically:true
            return "saved," & hasText
        end if
    end repeat

    -- TIFF only: convert to PNG via NSBitmapImageRep
    set tiffData to pb's dataForType:"public.tiff"
    if tiffData is not missing value then
        set bitmap to current application's NSBitmapImageRep's imageRepWithData:tiffData
        if bitmap is not missing value then
            set pngData to bitmap's representationUsingType:(current application's NSPNGFileType) properties:(missing value)
            if pngData is not missing value then
                pngData's writeToFile:tempPath atomically:true
                return "saved," & hasText
            end if
        end if
    end if
end try

return "none," & hasText
`;

/**
 * macOS clipboard provider using pngpaste/osascript
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

    try {
      // Fast path: pngpaste streams the image to stdout in a single small
      // process — no AppKit startup, no temp file.
      const fastBuffer = await this.readViaPngpaste();
      if (fastBuffer !== null) {
        return {
          hasImage: true,
          // pngpaste only reports image data; text presence is not needed
          // by the paste flow, so don't pay another spawn for it
          hasText: false,
          imageBuffer: fastBuffer,
          format: this.detectImageFormat(fastBuffer),
        };
      }

      // Single osascript invocation checks the clipboard and saves the image
      this.currentTempFile = await this.tempFileManager.createSecureTempFile('.png');
      const { stdout } = await execAsync(
        `osascript -e ${escapeShellArg(GET_CLIPBOARD_IMAGE_SCRIPT)}`,
        {
          timeout: TIMEOUTS.CLIPBOARD_READ,
          env: {
            ...process.env,
            CLIP_TEMP_PATH: this.currentTempFile,
          },
        }
      );

      const [saveResult, hasTextStr] = stdout.trim().split(',');
      const hasText = hasTextStr === 'true';

      if (saveResult !== 'saved') {
        return {
          hasImage: false,
          hasText,
          imageBuffer: null,
          format: null,
        };
      }

      const buffer = await fs.readFile(this.currentTempFile);
      if (buffer.length === 0) {
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
      await this.cleanup();
      throw new ClipboardError(
        `Failed to read clipboard: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Read the clipboard image via pngpaste's stdout, if pngpaste is installed.
   *
   * @returns PNG buffer, or null when pngpaste is unavailable, the clipboard
   *          has no image, or the read fails (callers fall back to osascript)
   */
  private async readViaPngpaste(): Promise<Buffer | null> {
    // Check pngpaste availability (cache result)
    if (pngpasteAvailable === null) {
      try {
        await execAsync('which pngpaste', { timeout: 1000 });
        pngpasteAvailable = true;
      } catch {
        pngpasteAvailable = false;
      }
    }

    if (!pngpasteAvailable) {
      return null;
    }

    try {
      // "-" writes the PNG to stdout; exits non-zero when there is no image
      const { stdout } = await execFileAsync('pngpaste', ['-'], {
        timeout: TIMEOUTS.CLIPBOARD_READ,
        encoding: 'buffer',
        maxBuffer: MAX_CLIPBOARD_BYTES,
      });
      return stdout.length > 0 ? stdout : null;
    } catch {
      // No image, old pngpaste without stdout support, or other failure —
      // the osascript path handles it
      return null;
    }
  }

  async cleanup(): Promise<void> {
    if (this.currentTempFile !== null && this.currentTempFile !== '') {
      await this.tempFileManager.cleanup(this.currentTempFile);
      this.currentTempFile = null;
    }
  }
}
