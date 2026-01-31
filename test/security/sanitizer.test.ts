/**
 * @fileoverview Test suite for security sanitization utilities
 *
 * These tests verify that the sanitizer module correctly handles:
 * - Cross-platform file name sanitization
 * - Shell command escaping and encoding
 * - Path traversal prevention
 * - Sensitive information redaction
 *
 * Platform-specific tests use conditional assertions to verify correct
 * behavior on Windows, macOS, and Linux.
 *
 * @see src/security/sanitizer.ts
 */

import { describe, it, expect } from 'vitest';
import {
  encodePowerShellCommand,
  buildSafePowerShellCommand,
  sanitizeFileName,
  containsDangerousChars,
  sanitizeDirectoryPath,
  escapeShellArg,
  sanitizeErrorMessage,
  getPlatform,
} from '../../src/security/sanitizer';

describe('sanitizer', () => {
  /**
   * Tests for getPlatform utility function
   *
   * This function normalizes platform detection to one of three supported
   * values: 'win32', 'darwin', or 'linux'. Unknown platforms default to 'linux'.
   */
  describe('getPlatform', () => {
    it('should return a valid platform identifier', () => {
      const platform = getPlatform();
      expect(['win32', 'darwin', 'linux']).toContain(platform);
    });

    it('should return a non-empty string', () => {
      const platform = getPlatform();
      expect(typeof platform).toBe('string');
      expect(platform.length).toBeGreaterThan(0);
    });
  });

  /**
   * Tests for PowerShell Base64 encoding
   *
   * PowerShell's -EncodedCommand parameter requires UTF-16LE encoded Base64.
   * This encoding method prevents command injection by ensuring the entire
   * script is treated as a single encoded blob.
   *
   * @see https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe
   */
  describe('encodePowerShellCommand', () => {
    it('should encode script to valid Base64 with UTF-16LE encoding', () => {
      const script = 'Write-Host "Hello"';
      const encoded = encodePowerShellCommand(script);

      // Verify Base64 format
      expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);

      // Verify round-trip: decode and compare
      const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
      expect(decoded).toBe(script);
    });

    it('should safely encode potential injection payloads', () => {
      // These payloads represent common command injection attempts
      const maliciousPayloads = [
        "'; Remove-Item -Recurse C:\\ -Force; '", // PowerShell injection
        '$(calc.exe)', // Subshell execution
        '`whoami`', // Backtick execution
        '| net user hacker password /add', // Pipe injection
        '; rm -rf /', // Unix command separator
      ];

      for (const payload of maliciousPayloads) {
        const encoded = encodePowerShellCommand(payload);

        // The encoded output should be pure Base64, not containing
        // any recognizable command strings
        expect(encoded).not.toContain('Remove-Item');
        expect(encoded).not.toContain('calc');
        expect(encoded).not.toContain('whoami');

        // Verify the encoding doesn't throw
        expect(() => Buffer.from(encoded, 'base64')).not.toThrow();
      }
    });
  });

  /**
   * Tests for safe PowerShell command construction
   *
   * This function builds a complete PowerShell invocation with security
   * best practices:
   * - -NoProfile: Prevents loading of user profile scripts
   * - -NonInteractive: Prevents prompts that could hang automation
   * - -ExecutionPolicy: Controls script execution permissions
   * - -EncodedCommand: Prevents injection via Base64 encoding
   */
  describe('buildSafePowerShellCommand', () => {
    it('should include all required security flags', () => {
      const result = buildSafePowerShellCommand('powershell.exe', 'echo test');

      expect(result).toContain('powershell.exe');
      expect(result).toContain('-NoProfile');
      expect(result).toContain('-NonInteractive');
      expect(result).toContain('-ExecutionPolicy');
      expect(result).toContain('-EncodedCommand');
    });

    it('should use RemoteSigned as default execution policy', () => {
      const result = buildSafePowerShellCommand('pwsh', 'echo test');

      // RemoteSigned is safer than Bypass while still allowing local scripts
      expect(result).toContain('RemoteSigned');
    });

    it('should accept custom execution policy when specified', () => {
      const result = buildSafePowerShellCommand(
        'powershell.exe',
        'echo test',
        'Bypass'
      );
      expect(result).toContain('Bypass');
    });

    it('should properly quote paths containing spaces', () => {
      const pathWithSpaces = 'C:\\Program Files\\PowerShell\\pwsh.exe';
      const result = buildSafePowerShellCommand(pathWithSpaces, 'test');

      // Path should be wrapped in double quotes
      expect(result).toContain(`"${pathWithSpaces}"`);
    });
  });

  /**
   * Tests for file name sanitization
   *
   * File names must be sanitized to:
   * 1. Remove characters invalid on any filesystem (control chars, <, >, etc.)
   * 2. Handle platform-specific restrictions (Windows reserved names, trailing dots)
   * 3. Enforce length limits to prevent filesystem errors
   * 4. Provide safe defaults for empty/invalid input
   */
  describe('sanitizeFileName', () => {
    /**
     * Common behavior tests - these should pass on all platforms
     */
    describe('common behavior (all platforms)', () => {
      it('should preserve valid file names unchanged', () => {
        // Standard file names with common characters should pass through
        expect(sanitizeFileName('image_2024_01_01.png')).toBe(
          'image_2024_01_01.png'
        );
        expect(sanitizeFileName('my-file.jpg')).toBe('my-file.jpg');
        expect(sanitizeFileName('Document (1).pdf')).toBe('Document (1).pdf');
      });

      it('should remove ASCII control characters (0x00-0x1F, 0x7F-0x9F)', () => {
        // Control characters can cause display issues and security problems
        expect(sanitizeFileName('test\x00file.png')).toBe('testfile.png');
        expect(sanitizeFileName('test\x1ffile.png')).toBe('testfile.png');
        expect(sanitizeFileName('test\x7ffile.png')).toBe('testfile.png');
      });

      it('should remove characters invalid on Windows filesystems', () => {
        // These characters are forbidden in Windows file names:
        // < > : " / \ | ? *
        // We remove them on all platforms for cross-platform compatibility
        expect(sanitizeFileName('file<name>.txt')).toBe('filename.txt');
        expect(sanitizeFileName('file:name.txt')).toBe('filename.txt');
        expect(sanitizeFileName('file|name.txt')).toBe('filename.txt');
        expect(sanitizeFileName('file"name.txt')).toBe('filename.txt');
        expect(sanitizeFileName('file?name.txt')).toBe('filename.txt');
        expect(sanitizeFileName('file*name.txt')).toBe('filename.txt');
        expect(sanitizeFileName('file/name.txt')).toBe('filename.txt');
        expect(sanitizeFileName('file\\name.txt')).toBe('filename.txt');
      });

      it('should normalize multiple consecutive spaces to single space', () => {
        expect(sanitizeFileName('file   name   here.txt')).toBe(
          'file name here.txt'
        );
      });

      it('should trim leading and trailing whitespace', () => {
        expect(sanitizeFileName('  file.txt  ')).toBe('file.txt');
        expect(sanitizeFileName('\tfile.txt\t')).toBe('file.txt');
      });

      it('should return default name "image" for empty or whitespace-only input', () => {
        expect(sanitizeFileName('')).toBe('image');
        expect(sanitizeFileName('   ')).toBe('image');
        expect(sanitizeFileName('\t\n')).toBe('image');
      });

      it('should truncate names exceeding maximum length while preserving extension', () => {
        const longName = 'a'.repeat(300) + '.png';
        const result = sanitizeFileName(longName);

        // Should be truncated to max 200 chars + extension
        expect(result.length).toBeLessThanOrEqual(204);
        expect(result.endsWith('.png')).toBe(true);
      });

      it('should truncate names without extension to maximum length', () => {
        const longName = 'a'.repeat(300);
        const result = sanitizeFileName(longName);

        expect(result.length).toBeLessThanOrEqual(200);
      });

      it('should not preserve extension if it would exceed reasonable length', () => {
        // Extension more than 10 chars from end is not treated as extension
        const longName = 'a'.repeat(190) + '.verylongextension';
        const result = sanitizeFileName(longName);

        expect(result.length).toBeLessThanOrEqual(200);
        // Extension is not preserved because it's too far from the end
      });
    });

    /**
     * Platform-specific behavior tests
     *
     * Windows has additional restrictions that don't apply to Unix systems:
     * - Trailing dots and spaces are not allowed
     * - Reserved device names (CON, PRN, NUL, etc.) cannot be used
     *
     * These tests verify correct behavior on each platform.
     */
    describe('platform-specific behavior', () => {
      it('should handle trailing dots and spaces according to platform rules', () => {
        const result = sanitizeFileName('file...   ');
        expect(result).toBeTruthy();

        if (process.platform === 'win32') {
          // Windows: trailing dots and spaces are silently stripped by the
          // filesystem, which can cause unexpected behavior. We remove them.
          expect(result).toBe('file');
          expect(result.endsWith('.')).toBe(false);
          expect(result.endsWith(' ')).toBe(false);
        } else {
          // Linux/macOS: trailing dots are valid (spaces are trimmed by
          // the common normalization step)
          expect(result).toBe('file...');
        }
      });

      it('should handle Windows reserved name CON', () => {
        const result = sanitizeFileName('CON.txt');

        if (process.platform === 'win32') {
          // Windows reserves CON as the console device
          // Prefix with underscore to make it a valid file name
          expect(result).toBe('_CON.txt');
        } else {
          // Unix systems have no reserved names
          expect(result).toBe('CON.txt');
        }
      });

      it('should handle Windows reserved name NUL', () => {
        const result = sanitizeFileName('NUL');

        if (process.platform === 'win32') {
          // NUL is the null device on Windows
          expect(result).toBe('_NUL');
        } else {
          expect(result).toBe('NUL');
        }
      });

      it('should handle Windows reserved name PRN with extension', () => {
        const result = sanitizeFileName('PRN.png');

        if (process.platform === 'win32') {
          // PRN is the printer device on Windows
          // Reserved names with extensions are still reserved
          expect(result).toBe('_PRN.png');
        } else {
          expect(result).toBe('PRN.png');
        }
      });
    });
  });

  /**
   * Tests for dangerous character detection
   *
   * These characters can be used for shell injection attacks if passed
   * unsanitized to shell commands.
   */
  describe('containsDangerousChars', () => {
    it('should detect shell metacharacters and injection vectors', () => {
      // Backticks - command substitution in bash
      expect(containsDangerousChars('`command`')).toBe(true);

      // Quotes - can break out of quoted strings
      expect(containsDangerousChars("'quoted'")).toBe(true);
      expect(containsDangerousChars('"double"')).toBe(true);

      // Dollar sign - variable expansion and subshells
      expect(containsDangerousChars('$variable')).toBe(true);

      // Semicolon - command separator
      expect(containsDangerousChars('cmd;cmd')).toBe(true);

      // Pipe - command chaining
      expect(containsDangerousChars('cmd|pipe')).toBe(true);

      // Ampersand - background execution and command chaining
      expect(containsDangerousChars('cmd&bg')).toBe(true);
    });

    it('should allow safe characters commonly used in file names', () => {
      expect(containsDangerousChars('safe_file-name.png')).toBe(false);
      expect(containsDangerousChars('image_2024_01_01')).toBe(false);
      expect(containsDangerousChars('path/to/file')).toBe(false);
      // Note: parentheses () are considered dangerous as they can be used
      // for subshell execution in bash, so 'file (1).txt' would return true
    });
  });

  /**
   * Tests for directory path sanitization
   *
   * Directory paths are normalized for consistent handling:
   * - Backslashes converted to forward slashes (cross-platform compatibility)
   * - Consecutive separators collapsed
   * - Control characters removed
   */
  describe('sanitizeDirectoryPath', () => {
    it('should normalize backslashes to forward slashes', () => {
      expect(sanitizeDirectoryPath('path\\to\\dir')).toBe('path/to/dir');
      expect(sanitizeDirectoryPath('C:\\Users\\name')).toBe('C:/Users/name');
    });

    it('should collapse consecutive path separators', () => {
      expect(sanitizeDirectoryPath('path//to///dir')).toBe('path/to/dir');
      expect(sanitizeDirectoryPath('path\\\\to\\\\\\dir')).toBe('path/to/dir');
    });

    it('should remove leading and trailing separators', () => {
      expect(sanitizeDirectoryPath('/path/to/dir/')).toBe('path/to/dir');
      expect(sanitizeDirectoryPath('///path///')).toBe('path');
    });

    it('should remove control characters from paths', () => {
      expect(sanitizeDirectoryPath('path\x00/to/dir')).toBe('path/to/dir');
      expect(sanitizeDirectoryPath('path\x1f/to\x7f/dir')).toBe('path/to/dir');
    });
  });

  /**
   * Tests for shell argument escaping
   *
   * Arguments passed to shell commands must be properly escaped to prevent
   * injection attacks. The escaping method differs by platform:
   * - Windows (cmd.exe): Double quotes with doubled internal quotes
   * - Unix (bash/sh): Single quotes with escaped internal single quotes
   */
  describe('escapeShellArg', () => {
    it('should wrap arguments in platform-appropriate quotes', () => {
      const result = escapeShellArg('test file.txt');

      if (process.platform === 'win32') {
        // Windows cmd.exe uses double quotes
        expect(result).toBe('"test file.txt"');
      } else {
        // Unix shells use single quotes (most characters literal)
        expect(result).toBe("'test file.txt'");
      }
    });

    it('should escape double quotes according to platform conventions', () => {
      const result = escapeShellArg('file with "quotes"');

      if (process.platform === 'win32') {
        // Windows: escape double quotes by doubling them
        expect(result).toBe('"file with ""quotes"""');
      } else {
        // Unix: double quotes are literal inside single quotes
        expect(result).toBe('\'file with "quotes"\'');
      }
    });

    it('should escape single quotes according to platform conventions', () => {
      const result = escapeShellArg("file with 'quotes'");

      if (process.platform === 'win32') {
        // Windows: single quotes are literal inside double quotes
        expect(result).toBe("\"file with 'quotes'\"");
      } else {
        // Unix: end single quote, add escaped single quote, restart single quote
        // 'file with '\''quotes'\'''
        expect(result).toBe("'file with '\\''quotes'\\'''");
      }
    });
  });

  /**
   * Tests for error message sanitization
   *
   * Error messages may contain sensitive information that should not be
   * exposed in logs or user-facing messages:
   * - User directory paths (privacy)
   * - Tokens and hashes (security)
   * - Passwords and API keys (security)
   */
  describe('sanitizeErrorMessage', () => {
    it('should redact Windows user directory paths', () => {
      const message = 'Error at C:\\Users\\john\\Documents\\file.txt';
      const result = sanitizeErrorMessage(message);

      expect(result).toContain('[USER_DIR]');
      expect(result).not.toContain('john');
    });

    it('should redact Unix user directory paths', () => {
      const homeDir = 'Error at /home/john/Documents/file.txt';
      expect(sanitizeErrorMessage(homeDir)).toContain('[USER_DIR]');

      const macDir = 'Error at /Users/john/Documents/file.txt';
      expect(sanitizeErrorMessage(macDir)).toContain('[USER_DIR]');
    });

    it('should redact long hexadecimal strings (potential tokens/hashes)', () => {
      const message = 'Token: abcdef0123456789abcdef0123456789 was invalid';
      const result = sanitizeErrorMessage(message);

      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('abcdef0123456789');
    });

    it('should redact password-like key-value pairs', () => {
      const patterns = [
        'password=secret123',
        'secret: mysecretvalue',
        'api_key=sk_live_abc123',
        'token: bearer_xyz789',
      ];

      for (const pattern of patterns) {
        const result = sanitizeErrorMessage(`Connection failed: ${pattern}`);
        expect(result).toContain('[REDACTED]');
      }
    });

    it('should preserve safe messages without modification', () => {
      const safeMessages = [
        'Operation completed successfully',
        'File not found',
        'Invalid format: expected PNG or JPEG',
        'Clipboard is empty',
      ];

      for (const message of safeMessages) {
        expect(sanitizeErrorMessage(message)).toBe(message);
      }
    });
  });
});
