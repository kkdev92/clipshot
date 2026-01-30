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

/**
 * PowerShell script to check if clipboard has an image and save it
 * Returns: hasImage,hasText,tempFilePath,method
 */
const CLIPBOARD_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$hasImage = $false
$hasText = $false
$tempPath = ""
$method = "none"

try {
    # Check for text
    if ([System.Windows.Forms.Clipboard]::ContainsText()) {
        $hasText = $true
    }

    # Try WinForms API first (most compatible)
    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
        $hasImage = $true
        $img = [System.Windows.Forms.Clipboard]::GetImage()
        if ($img -ne $null) {
            $tempPath = $env:CLIP_TEMP_PATH
            $img.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $method = "winforms"
            $img.Dispose()
        }
    }
} catch {
    # WinForms failed, try WPF as fallback
    try {
        Add-Type -AssemblyName PresentationCore
        $wpfImg = [System.Windows.Clipboard]::GetImage()
        if ($wpfImg -ne $null) {
            $hasImage = $true
            $tempPath = $env:CLIP_TEMP_PATH
            $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
            $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($wpfImg))
            $stream = [System.IO.File]::Create($tempPath)
            $encoder.Save($stream)
            $stream.Close()
            $method = "wpf"
        }
    } catch {
        # Both methods failed
    }
}

Write-Output "::RESULT::$hasImage,$hasText,$tempPath,$method"
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
        `"${psPath}" -NoProfile -NonInteractive -ExecutionPolicy ${this.executionPolicy} -EncodedCommand ${encodedCommand}`,
        {
          timeout: TIMEOUTS.CLIPBOARD_READ,
          env: {
            ...process.env,
            CLIP_TEMP_PATH: this.currentTempFile,
          },
          windowsHide: true,
        }
      );

      if (stderr && !stderr.includes('WARNING')) {
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

  private async getPowerShellPath(): Promise<string> {
    // Check for PowerShell 7 (pwsh) first - better for ARM64
    try {
      await execAsync('pwsh -NoProfile -Command "echo ok"', { timeout: 5000 });
      return 'pwsh';
    } catch {
      // Fall back to Windows PowerShell
      return 'powershell.exe';
    }
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
