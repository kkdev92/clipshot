/**
 * Windows clipboard provider
 * Uses PowerShell with Base64 encoding for secure execution
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { ClipboardData } from '../../core/types';
import { ClipboardError } from '../../core/errors';
import { TIMEOUTS } from '../../core/constants';
import { BaseClipboardProvider } from '../clipboard-provider';
import { encodePowerShellCommand } from '../../security/sanitizer';
import { getTempFileManager } from '../../security/temp-file-manager';

const execAsync = promisify(exec);

// Cache PowerShell path to avoid repeated detection
let cachedPowerShellPath: string | null = null;

/**
 * PowerShell script to check if clipboard contains an image and save it to a temp file.
 *
 * Output format: ::RESULT::hasImage,hasText,tempFilePath
 *
 * Optimizations applied:
 * - Single Add-Type call loads both assemblies at once
 * - Early exit when no image is present (avoids unnecessary processing)
 */
const CLIPBOARD_SCRIPT = `
# Load required .NET assemblies in a single call for faster startup
Add-Type -AssemblyName System.Windows.Forms,System.Drawing

$clipboard = [System.Windows.Forms.Clipboard]
$hasText = $clipboard::ContainsText()

# Early exit if no image in clipboard
if (-not $clipboard::ContainsImage()) {
    "::RESULT::False,$hasText,"
    return
}

$image = $clipboard::GetImage()
if ($image -eq $null) {
    "::RESULT::False,$hasText,"
    return
}

# Save image as PNG
$tempPath = $env:CLIP_TEMP_PATH
$image.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
$image.Dispose()

"::RESULT::True,$hasText,$tempPath"
`;

/**
 * Windows clipboard provider using PowerShell
 */
export class WindowsClipboardProvider extends BaseClipboardProvider {
  private readonly tempFileManager = getTempFileManager();
  private currentTempFile: string | null = null;
  private readonly executionPolicy: string;

  constructor() {
    super('windows');
    // Allow override via environment variable for enterprise environments
    this.executionPolicy = process.env['CLAUDE_IMG_EXECUTION_POLICY'] ?? 'RemoteSigned';
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if PowerShell is available
      await execAsync('powershell.exe -NoProfile -Command "echo ok"', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async hasImage(): Promise<boolean> {
    const data = await this.getImageData();
    return data.hasImage;
  }

  async getImageData(): Promise<ClipboardData> {
    // Clean up previous temp file if any
    await this.cleanup();

    // Create a new temp file for this operation
    this.currentTempFile = await this.tempFileManager.createSecureTempFile('.png');

    try {
      const result = await this.executeClipboardScript();
      return result;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  private async executeClipboardScript(): Promise<ClipboardData> {
    if (this.currentTempFile === null || this.currentTempFile === '') {
      throw new ClipboardError('Temp file not initialized');
    }

    // Encode the script for safe execution
    const encodedCommand = encodePowerShellCommand(CLIPBOARD_SCRIPT);

    // Get PowerShell path (prefer pwsh for ARM64)
    const psPath = await this.getPowerShellPath();

    try {
      const { stdout, stderr } = await execAsync(
        `"${psPath}" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy ${this.executionPolicy} -EncodedCommand ${encodedCommand}`,
        {
          timeout: TIMEOUTS.CLIPBOARD_READ,
          env: {
            ...process.env,
            CLIP_TEMP_PATH: this.currentTempFile,
          },
          windowsHide: true,
        }
      );

      // Ignore non-error stderr output:
      // - WARNING: PowerShell warnings
      // - CLIXML progress messages (contain '<Objs' with 'progress' type)
      //   These occur during first-time .NET assembly loading
      if (stderr && !this.isIgnorableStderr(stderr)) {
        throw new ClipboardError(`PowerShell error: ${stderr}`);
      }

      return this.parseResult(stdout);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
        throw new ClipboardError('Clipboard read timed out');
      }
      throw new ClipboardError(
        `Failed to read clipboard: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private parseResult(stdout: string): ClipboardData {
    // Find the result line
    const resultLine = stdout.split('\n').find((line) => line.startsWith('::RESULT::'));
    if (resultLine === undefined || resultLine === '') {
      return this.createEmptyClipboardData();
    }

    const parts = resultLine.replace('::RESULT::', '').trim().split(',');
    const hasImage = parts[0]?.toLowerCase() === 'true';
    const hasText = parts[1]?.toLowerCase() === 'true';
    const tempPath = parts[2] ?? '';

    if (!hasImage || tempPath === '' || this.currentTempFile === null || this.currentTempFile === '') {
      return {
        hasImage: false,
        hasText,
        imageBuffer: null,
        format: null,
      };
    }

    // Read the image file
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      const buffer = fs.readFileSync(this.currentTempFile);
      const format = this.detectImageFormat(buffer);

      return {
        hasImage: true,
        hasText,
        imageBuffer: buffer,
        format,
      };
    } catch {
      return {
        hasImage: false,
        hasText,
        imageBuffer: null,
        format: null,
      };
    }
  }

  /**
   * Determines if stderr output from PowerShell can be safely ignored.
   *
   * PowerShell writes several types of non-error messages to stderr:
   *
   * 1. **WARNING messages**: Informational warnings that don't indicate failure
   *
   * 2. **CLIXML progress messages**: XML-formatted progress notifications that occur
   *    during first-time loading of .NET assemblies (System.Windows.Forms, System.Drawing).
   *    These are commonly seen on devices where the assemblies haven't been cached yet,
   *    such as fresh Windows installations or Surface devices.
   *
   *    Example CLIXML progress message:
   *    ```xml
   *    #< CLIXML
   *    <Objs Version="1.1.0.1" xmlns="...">
   *      <Obj S="progress" RefId="0">
   *        <MS><PR N="Record"><T>Completed</T>...</PR></MS>
   *      </Obj>
   *    </Objs>
   *    ```
   *
   * @param stderr - The stderr output from PowerShell execution
   * @returns true if the stderr content is non-error output that can be ignored
   *
   * @see https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection
   */
  private isIgnorableStderr(stderr: string): boolean {
    // PowerShell warnings (stream 3) are redirected to stderr but aren't errors
    if (stderr.includes('WARNING')) {
      return true;
    }

    // CLIXML progress messages from .NET assembly loading
    // These occur during first-time loading of System.Windows.Forms/System.Drawing
    // The presence of both '<Objs' (CLIXML root) and 'progress' (stream type) indicates
    // this is a progress notification, not an error
    if (stderr.includes('<Objs') && stderr.includes('progress')) {
      return true;
    }

    // Progress messages that have completed successfully
    // The <T>Completed</T> tag indicates the operation finished without error
    if (stderr.includes('<T>Completed</T>')) {
      return true;
    }

    return false;
  }

  private async getPowerShellPath(): Promise<string> {
    // Return cached path if available
    if (cachedPowerShellPath !== null) {
      return cachedPowerShellPath;
    }

    // Check for PowerShell 7 (pwsh) first - better for ARM64
    try {
      await execAsync('pwsh -NoProfile -Command "echo ok"', { timeout: 5000 });
      cachedPowerShellPath = 'pwsh';
    } catch {
      // Fall back to Windows PowerShell
      cachedPowerShellPath = 'powershell.exe';
    }

    return cachedPowerShellPath;
  }

  async cleanup(): Promise<void> {
    if (this.currentTempFile !== null && this.currentTempFile !== '') {
      await this.tempFileManager.cleanup(this.currentTempFile);
      this.currentTempFile = null;
    }
  }
}

/**
 * Check if running on ARM64 Windows
 *
 * @returns True if running on ARM64 Windows architecture
 * @internal Exported for potential future use and testing
 */
export function isARM64Windows(): boolean {
  const arch = process.arch;
  const platform = process.platform;
  return platform === 'win32' && arch === 'arm64';
}

/**
 * Parsed result from PowerShell clipboard script
 */
export interface ParsedResultOutput {
  hasImage: boolean;
  hasText: boolean;
  tempPath: string;
}

/**
 * Parse the output from the PowerShell clipboard script.
 * Exported for testing purposes.
 *
 * @param stdout - The stdout from PowerShell execution
 * @returns Parsed result object
 */
export function parseResultOutput(stdout: string): ParsedResultOutput {
  const resultLine = stdout.split('\n').find((line) => line.startsWith('::RESULT::'));
  if (resultLine === undefined || resultLine === '') {
    return { hasImage: false, hasText: false, tempPath: '' };
  }

  const parts = resultLine.replace('::RESULT::', '').trim().split(',');
  return {
    hasImage: parts[0]?.toLowerCase() === 'true',
    hasText: parts[1]?.toLowerCase() === 'true',
    tempPath: parts[2] ?? '',
  };
}

/**
 * The PowerShell script used for clipboard operations.
 * Exported for testing purposes.
 */
export { CLIPBOARD_SCRIPT };
