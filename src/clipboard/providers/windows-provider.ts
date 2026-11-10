/**
 * Windows clipboard provider
 * Uses PowerShell with Base64 encoding for secure execution
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ClipboardData } from '../../core/types';
import { ClipboardError } from '../../core/errors';
import { TIMEOUTS } from '../../core/constants';
import { BaseClipboardProvider } from '../clipboard-provider';
import { encodePowerShellCommand } from '../../security/sanitizer';
import { getTempFileManager } from '../../security/temp-file-manager';

const execFileAsync = promisify(execFile);

/**
 * PowerShell executables, in the order they are tried.
 *
 * Windows PowerShell goes first: it is part of Windows, the script needs
 * nothing newer than the .NET clipboard API that both have, and it starts
 * sooner than PowerShell 7 does. PowerShell 7 is there for a machine where
 * Windows PowerShell cannot be started, or does not get through the script.
 */
const POWERSHELL_EXECUTABLES = ['powershell.exe', 'pwsh'] as const;

/**
 * PowerShell script to check if clipboard contains an image and save it to a temp file.
 *
 * Output format: ::RESULT::hasImage,hasText,tempFilePath
 *
 * Optimizations applied:
 * - Single Add-Type call loads both assemblies at once
 * - Early exit when no image is present (avoids unnecessary processing)
 * - Raw "PNG" clipboard data (set by browsers, Snipping Tool, etc.) is written
 *   as-is, skipping the slow GDI+ decode + PNG re-encode and preserving the
 *   alpha channel that GetImage() drops
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

$tempPath = $env:CLIP_TEMP_PATH

# Fast path: many apps put an encoded PNG directly on the clipboard.
# Writing those bytes as-is avoids a GDI+ re-encode entirely.
$dataObject = $clipboard::GetDataObject()
if ($dataObject -ne $null -and $dataObject.GetDataPresent("PNG")) {
    $pngStream = $dataObject.GetData("PNG")
    if ($pngStream -is [System.IO.Stream] -and $pngStream.Length -gt 8) {
        $pngStream.Position = 0
        $fileStream = [System.IO.File]::Create($tempPath)
        $pngStream.CopyTo($fileStream)
        $fileStream.Dispose()
        "::RESULT::True,$hasText,$tempPath"
        return
    }
}

# Fallback: decode via GDI+ and encode as PNG
$image = $clipboard::GetImage()
if ($image -eq $null) {
    "::RESULT::False,$hasText,"
    return
}

$image.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
$image.Dispose()

"::RESULT::True,$hasText,$tempPath"
`;

/**
 * Execution policy passed to PowerShell.
 *
 * A constant on purpose. This used to read `CLAUDE_IMG_EXECUTION_POLICY`, which
 * arrived with the original scaffold, was named after something unrelated to this
 * extension, and was referenced nowhere else — no documentation, no setting, no
 * test. What it did do was interpolate an unvalidated string into the command
 * line below, where a value like `Bypass & something.exe` would have run.
 *
 * Nobody who cannot already set this process's environment could reach it, so the
 * override was never a way in. It was a way to *lower* a security setting with no
 * record of having done so, which is worth less than nothing.
 */
const EXECUTION_POLICY = 'RemoteSigned';

/**
 * The arguments PowerShell is started with. All of them are constant; the one
 * value that changes per read, the temporary file, goes in the environment.
 */
const POWERSHELL_ARGUMENTS: readonly string[] = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  EXECUTION_POLICY,
  '-EncodedCommand',
  encodePowerShellCommand(CLIPBOARD_SCRIPT),
];

/** Node ends a child that outlives `timeout`, and reports it as killed. */
function isTimeout(error: unknown): boolean {
  return (error as { killed?: boolean }).killed === true;
}

/** The executable is not on the PATH. */
function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Windows clipboard provider using PowerShell
 */
export class WindowsClipboardProvider extends BaseClipboardProvider {
  private readonly tempFileManager = getTempFileManager();
  private currentTempFile: string | null = null;
  /** The executable that last read the clipboard, so later reads start with it. */
  private powerShell: string | null = null;

  constructor() {
    super('windows');
  }

  isAvailable(): Promise<boolean> {
    // Windows PowerShell is part of Windows, so there is nothing to look for
    // first. Starting a PowerShell only to see that it starts took about as
    // long as the read itself; a machine where none starts finds out from the
    // read, which says so. (pwsh also exists on Linux and macOS, but the
    // WinForms clipboard does not.)
    return Promise.resolve(process.platform === 'win32');
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

    // The executable that worked last time, or each candidate in turn. Nothing
    // checks beforehand that one starts: the read is the check, so a paste
    // costs one PowerShell startup rather than two.
    const executables = this.powerShell !== null ? [this.powerShell] : POWERSHELL_EXECUTABLES;

    let failure: ClipboardError | null = null;
    for (const executable of executables) {
      try {
        const data = await this.readWith(executable, this.currentTempFile);
        this.powerShell = executable;
        return data;
      } catch (error) {
        if (isTimeout(error)) {
          // Waiting out a second timeout would only make the wait longer
          throw new ClipboardError('Clipboard read timed out');
        }
        if (!isNotFound(error)) {
          // Of several failures, the first from a PowerShell that ran is the
          // one worth reporting
          failure ??= new ClipboardError(
            `Failed to read clipboard: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    if (failure !== null) {
      throw failure;
    }

    // None of them could be found. Forget the remembered one, so that the next
    // read looks for all of them again.
    this.powerShell = null;
    throw new ClipboardError(
      `PowerShell could not be started: ${executables.join(' and ')} not found`,
      'PowerShell could not be started'
    );
  }

  /**
   * Run the clipboard script in one PowerShell and parse what it reports.
   *
   * The executable is started directly with an argument array, so no shell
   * parses a command line in between.
   */
  private async readWith(executable: string, tempFile: string): Promise<ClipboardData> {
    const { stdout, stderr } = await execFileAsync(executable, [...POWERSHELL_ARGUMENTS], {
      timeout: TIMEOUTS.CLIPBOARD_READ,
      env: {
        ...process.env,
        CLIP_TEMP_PATH: tempFile,
      },
      windowsHide: true,
    });

    // Ignore non-error stderr output:
    // - WARNING: PowerShell warnings
    // - CLIXML progress messages (contain '<Objs' with 'progress' type)
    //   These occur during first-time .NET assembly loading
    if (stderr && !this.isIgnorableStderr(stderr)) {
      throw new ClipboardError(`PowerShell error: ${stderr}`);
    }

    return this.parseResult(stdout);
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
 * The PowerShell script used for clipboard operations, and the arguments
 * PowerShell is started with to run it.
 * Exported for testing purposes.
 */
export { CLIPBOARD_SCRIPT, POWERSHELL_ARGUMENTS };
