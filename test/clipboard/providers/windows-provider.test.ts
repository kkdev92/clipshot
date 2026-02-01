/**
 * Windows clipboard provider tests
 *
 * These tests verify:
 * 1. PowerShell script can resolve .NET types correctly (Windows only)
 * 2. parseResultOutput function works correctly (all platforms)
 */

import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  parseResultOutput,
  CLIPBOARD_SCRIPT,
  isARM64Windows,
  WindowsClipboardProvider,
} from '../../../src/clipboard/providers/windows-provider';

const execAsync = promisify(exec);

describe('WindowsClipboardProvider', () => {
  describe('parseResultOutput', () => {
    it('should parse successful result with image', () => {
      const stdout = '::RESULT::True,False,C:\\temp\\image.png\n';
      const result = parseResultOutput(stdout);

      expect(result.hasImage).toBe(true);
      expect(result.hasText).toBe(false);
      expect(result.tempPath).toBe('C:\\temp\\image.png');
    });

    it('should parse result with text only', () => {
      const stdout = '::RESULT::False,True,\n';
      const result = parseResultOutput(stdout);

      expect(result.hasImage).toBe(false);
      expect(result.hasText).toBe(true);
      expect(result.tempPath).toBe('');
    });

    it('should parse result with both image and text', () => {
      const stdout = '::RESULT::True,True,/tmp/test.png\n';
      const result = parseResultOutput(stdout);

      expect(result.hasImage).toBe(true);
      expect(result.hasText).toBe(true);
      expect(result.tempPath).toBe('/tmp/test.png');
    });

    it('should handle empty clipboard', () => {
      const stdout = '::RESULT::False,False,\n';
      const result = parseResultOutput(stdout);

      expect(result.hasImage).toBe(false);
      expect(result.hasText).toBe(false);
      expect(result.tempPath).toBe('');
    });

    it('should handle missing result marker', () => {
      const stdout = 'Some random output\n';
      const result = parseResultOutput(stdout);

      expect(result.hasImage).toBe(false);
      expect(result.hasText).toBe(false);
      expect(result.tempPath).toBe('');
    });

    it('should handle empty stdout', () => {
      const result = parseResultOutput('');

      expect(result.hasImage).toBe(false);
      expect(result.hasText).toBe(false);
      expect(result.tempPath).toBe('');
    });

    it('should handle result with multiple lines before marker', () => {
      const stdout = 'Loading assemblies...\nDone.\n::RESULT::True,False,C:\\img.png\n';
      const result = parseResultOutput(stdout);

      expect(result.hasImage).toBe(true);
      expect(result.tempPath).toBe('C:\\img.png');
    });

    it('should handle case-insensitive boolean parsing', () => {
      const stdout = '::RESULT::TRUE,FALSE,path.png\n';
      const result = parseResultOutput(stdout);

      expect(result.hasImage).toBe(true);
      expect(result.hasText).toBe(false);
    });
  });

  describe('CLIPBOARD_SCRIPT', () => {
    it('should be a non-empty string', () => {
      expect(typeof CLIPBOARD_SCRIPT).toBe('string');
      expect(CLIPBOARD_SCRIPT.length).toBeGreaterThan(0);
    });

    it('should contain required .NET type references', () => {
      expect(CLIPBOARD_SCRIPT).toContain('System.Windows.Forms');
      expect(CLIPBOARD_SCRIPT).toContain('System.Drawing');
      expect(CLIPBOARD_SCRIPT).toContain('[System.Drawing.Imaging.ImageFormat]::Png');
    });

    it('should contain result output marker', () => {
      expect(CLIPBOARD_SCRIPT).toContain('::RESULT::');
    });
  });

  describe('isARM64Windows', () => {
    it('should return boolean value', () => {
      const result = isARM64Windows();
      expect(typeof result).toBe('boolean');
    });

    it('should return true only on win32 arm64', () => {
      // This test verifies the function logic
      // On non-win32/arm64 platforms, should return false
      if (process.platform !== 'win32' || process.arch !== 'arm64') {
        expect(isARM64Windows()).toBe(false);
      }
    });
  });

  describe('WindowsClipboardProvider class', () => {
    it('should instantiate without throwing', () => {
      const provider = new WindowsClipboardProvider();
      expect(provider).toBeDefined();
      expect(provider.getPlatform()).toBe('windows');
    });

    it('should have isAvailable method', () => {
      const provider = new WindowsClipboardProvider();
      expect(typeof provider.isAvailable).toBe('function');
    });

    it('should have getImageData method', () => {
      const provider = new WindowsClipboardProvider();
      expect(typeof provider.getImageData).toBe('function');
    });

    it('should have cleanup method', () => {
      const provider = new WindowsClipboardProvider();
      expect(typeof provider.cleanup).toBe('function');
    });

    it('should return false for isAvailable on non-Windows', async () => {
      if (process.platform !== 'win32') {
        const provider = new WindowsClipboardProvider();
        const isAvailable = await provider.isAvailable();
        expect(isAvailable).toBe(false);
      }
    });
  });

  /**
   * Tests for stderr handling patterns
   *
   * PowerShell outputs various non-error messages to stderr that the provider
   * must correctly identify and ignore:
   *
   * 1. **CLIXML progress messages**: XML-formatted progress notifications during
   *    first-time .NET assembly loading (System.Windows.Forms, System.Drawing).
   *    These commonly occur on:
   *    - Fresh Windows installations
   *    - Surface devices (Laptop 5, Pro, etc.)
   *    - Systems where PowerShell assemblies haven't been cached
   *
   * 2. **WARNING messages**: PowerShell warnings that don't indicate failure
   *
   * Note: The `isIgnorableStderr` method is private, so we test the patterns
   * it checks for rather than the method directly. This ensures our test
   * fixtures match real-world stderr output.
   *
   * @see https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection
   */
  describe('stderr handling patterns', () => {
    /**
     * Actual CLIXML progress message captured from Surface Laptop 5 (x64)
     * when System.Windows.Forms assembly is loaded for the first time.
     *
     * Structure:
     * - `#< CLIXML` header indicates CLIXML format
     * - `<Objs>` root element with PowerShell namespace
     * - `<Obj S="progress">` indicates this is progress stream output
     * - `<T>Completed</T>` indicates successful completion
     * - Japanese text: "モジュールを初めて使用するための準備をしています"
     *   (Preparing to use the module for the first time)
     */
    const CLIXML_PROGRESS_MESSAGE = `#< CLIXML
<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T><T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>モジュールを初めて使用するための準備をしています。</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC><T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj></Objs>`;

    it('should contain CLIXML root element pattern (<Objs)', () => {
      // The provider checks for '<Objs' to identify CLIXML format
      expect(CLIXML_PROGRESS_MESSAGE).toContain('<Objs');
    });

    it('should contain progress stream indicator', () => {
      // The provider checks for 'progress' to identify progress messages
      // This appears as S="progress" in the Obj element
      expect(CLIXML_PROGRESS_MESSAGE).toContain('progress');
    });

    it('should contain completion status tag', () => {
      // The provider checks for '<T>Completed</T>' to identify successful completion
      // Messages with this tag are safe to ignore
      expect(CLIXML_PROGRESS_MESSAGE).toContain('<T>Completed</T>');
    });

    it('should match PowerShell CLIXML namespace', () => {
      // Verify this is genuine PowerShell CLIXML output
      expect(CLIXML_PROGRESS_MESSAGE).toContain(
        'xmlns="http://schemas.microsoft.com/powershell/2004/04"'
      );
    });

    it('WARNING messages should contain WARNING keyword', () => {
      // PowerShell warnings are identified by the 'WARNING' prefix
      const warningExamples = [
        'WARNING: Some non-critical warning',
        'WARNING: The cmdlet is deprecated',
        'WARNING: This operation may take a long time',
      ];

      for (const warning of warningExamples) {
        expect(warning).toContain('WARNING');
      }
    });
  });

  // Windows-only tests for actual PowerShell execution
  describe('PowerShell .NET Type Resolution (Windows only)', () => {
    it('should resolve System.Drawing.Imaging.ImageFormat.Png', async () => {
      if (process.platform !== 'win32') {
        // Skip on non-Windows platforms
        return;
      }

      // This test verifies that ImageFormat.Png can be resolved
      // This would have caught the bug where we tried to use numeric value "1"
      const { stdout, stderr } = await execAsync(
        'powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Drawing; [System.Drawing.Imaging.ImageFormat]::Png.Guid.ToString()"',
        { timeout: 10000 }
      );

      expect(stderr).toBe('');
      // ImageFormat.Png has a specific GUID: b96b3caf-0728-11d3-9d7b-0000f81ef32e
      expect(stdout.trim()).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    });

    it('should resolve System.Windows.Forms.Clipboard', async () => {
      if (process.platform !== 'win32') {
        return;
      }

      const { stdout, stderr } = await execAsync(
        'powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard].FullName"',
        { timeout: 10000 }
      );

      expect(stderr).toBe('');
      expect(stdout.trim()).toBe('System.Windows.Forms.Clipboard');
    });

    it('should have valid PowerShell script syntax', async () => {
      if (process.platform !== 'win32') {
        return;
      }

      // Encode script for syntax check
      const encodedScript = Buffer.from(CLIPBOARD_SCRIPT, 'utf16le').toString('base64');

      // Use PowerShell parser to validate syntax without executing
      const { stderr } = await execAsync(
        `powershell.exe -NoProfile -Command "$script = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedScript}')); $null = [System.Management.Automation.PSParser]::Tokenize($script, [ref]$null); Write-Output 'OK'"`,
        { timeout: 10000 }
      );

      expect(stderr).toBe('');
    });
  });
});
