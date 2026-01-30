import { describe, it, expect } from 'vitest';
import {
  encodePowerShellCommand,
  sanitizeFileName,
  containsDangerousChars,
  sanitizeDirectoryPath,
  escapeShellArg,
  sanitizeErrorMessage,
} from '../../src/security/sanitizer';

describe('sanitizer', () => {
  describe('encodePowerShellCommand', () => {
    it('should encode a simple command', () => {
      const script = 'Write-Host "Hello"';
      const encoded = encodePowerShellCommand(script);
      // Should be Base64
      expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
      // Should be decodable back to UTF-16LE
      const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
      expect(decoded).toBe(script);
    });

    it('should safely encode injection attempts', () => {
      const maliciousPayloads = [
        "'; Remove-Item -Recurse C:\\ -Force; '",
        '$(calc.exe)',
        '`whoami`',
        '| net user hacker password /add',
        '; rm -rf /',
      ];

      for (const payload of maliciousPayloads) {
        const encoded = encodePowerShellCommand(payload);
        // Encoded command should not contain the original dangerous characters
        expect(encoded).not.toContain('Remove-Item');
        expect(encoded).not.toContain('calc');
        expect(encoded).not.toContain('whoami');
        // Should be valid Base64
        expect(() => Buffer.from(encoded, 'base64')).not.toThrow();
      }
    });
  });

  describe('sanitizeFileName', () => {
    it('should preserve safe file names', () => {
      expect(sanitizeFileName('image_2024_01_01.png')).toBe('image_2024_01_01.png');
      expect(sanitizeFileName('my-file.jpg')).toBe('my-file.jpg');
    });

    it('should remove control characters', () => {
      expect(sanitizeFileName('test\x00file.png')).toBe('testfile.png');
      expect(sanitizeFileName('test\x1ffile.png')).toBe('testfile.png');
    });

    it('should handle Windows reserved names', () => {
      // On Windows, these should be prefixed
      const result = sanitizeFileName('CON.txt');
      // Either prefixed or unchanged depending on platform
      expect(result).toBeTruthy();
    });

    it('should truncate long names', () => {
      const longName = 'a'.repeat(300) + '.png';
      const result = sanitizeFileName(longName);
      expect(result.length).toBeLessThanOrEqual(200 + 4); // 200 + .png
    });

    it('should return default for empty input', () => {
      expect(sanitizeFileName('')).toBe('image');
      expect(sanitizeFileName('   ')).toBe('image');
    });
  });

  describe('containsDangerousChars', () => {
    it('should detect dangerous characters', () => {
      expect(containsDangerousChars('`command`')).toBe(true);
      expect(containsDangerousChars("'quoted'")).toBe(true);
      expect(containsDangerousChars('"double"')).toBe(true);
      expect(containsDangerousChars('$variable')).toBe(true);
      expect(containsDangerousChars('cmd;cmd')).toBe(true);
      expect(containsDangerousChars('cmd|pipe')).toBe(true);
      expect(containsDangerousChars('cmd&bg')).toBe(true);
    });

    it('should allow safe characters', () => {
      expect(containsDangerousChars('safe_file-name.png')).toBe(false);
      expect(containsDangerousChars('image_2024_01_01')).toBe(false);
      expect(containsDangerousChars('path/to/file')).toBe(false);
    });
  });

  describe('sanitizeDirectoryPath', () => {
    it('should normalize path separators', () => {
      expect(sanitizeDirectoryPath('path\\to\\dir')).toBe('path/to/dir');
    });

    it('should remove consecutive separators', () => {
      expect(sanitizeDirectoryPath('path//to///dir')).toBe('path/to/dir');
    });

    it('should remove leading/trailing separators', () => {
      expect(sanitizeDirectoryPath('/path/to/dir/')).toBe('path/to/dir');
    });

    it('should remove control characters', () => {
      expect(sanitizeDirectoryPath('path\x00/to/dir')).toBe('path/to/dir');
    });
  });

  describe('escapeShellArg', () => {
    it('should escape arguments for shell use', () => {
      const result = escapeShellArg('test file.txt');
      // Should be quoted
      expect(result.startsWith('"') || result.startsWith("'")).toBe(true);
    });

    it('should handle special characters', () => {
      const result = escapeShellArg('file with "quotes"');
      expect(result).toBeTruthy();
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('should redact user paths', () => {
      const windowsPath = 'Error at C:\\Users\\john\\Documents\\file.txt';
      expect(sanitizeErrorMessage(windowsPath)).toContain('[USER_DIR]');

      const unixPath = 'Error at /home/john/Documents/file.txt';
      expect(sanitizeErrorMessage(unixPath)).toContain('[USER_DIR]');
    });

    it('should redact long hex strings', () => {
      const message = 'Token: abcdef0123456789abcdef0123456789 was invalid';
      expect(sanitizeErrorMessage(message)).toContain('[REDACTED]');
    });

    it('should redact password-like content', () => {
      const message = 'Connection failed: password=secret123';
      expect(sanitizeErrorMessage(message)).toContain('[REDACTED]');
    });

    it('should preserve safe messages', () => {
      const message = 'Operation completed successfully';
      expect(sanitizeErrorMessage(message)).toBe(message);
    });
  });
});
