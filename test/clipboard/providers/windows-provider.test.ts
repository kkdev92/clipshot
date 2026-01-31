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
import { parseResultOutput, CLIPBOARD_SCRIPT } from '../../../src/clipboard/providers/windows-provider';

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
