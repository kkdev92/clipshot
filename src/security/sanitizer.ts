/**
 * Input sanitization utilities for security
 * Prevents command injection and other security vulnerabilities
 */

import * as os from 'os';
import type { Platform } from '../core/types';
import {
  DANGEROUS_SHELL_CHARS,
  WINDOWS_RESERVED_NAMES,
  LIMITS,
} from '../core/constants';

/**
 * Get current platform
 */
export function getPlatform(): Platform {
  const platform = os.platform();
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  // Default to linux for other Unix-like systems
  return 'linux';
}

/**
 * Encode a PowerShell script to Base64 for safe execution
 * Uses UTF-16LE encoding as required by PowerShell's -EncodedCommand
 *
 * @param script - The PowerShell script to encode
 * @returns Base64-encoded script
 */
export function encodePowerShellCommand(script: string): string {
  // PowerShell -EncodedCommand expects UTF-16LE (Little Endian Unicode)
  const buffer = Buffer.from(script, 'utf16le');
  return buffer.toString('base64');
}

/**
 * Sanitize a file name by removing dangerous characters
 * Works cross-platform
 *
 * @param fileName - The file name to sanitize
 * @returns Sanitized file name
 */
export function sanitizeFileName(fileName: string): string {
  const platform = getPlatform();
  let sanitized = fileName;

  // Remove control characters
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

  // Remove characters that are problematic on any platform
  // This includes Windows-invalid characters and shell metacharacters
  sanitized = sanitized.replace(/[<>:"/\\|?*]/g, '');

  // Platform-specific sanitization
  if (platform === 'win32') {
    // Remove trailing dots and spaces (Windows doesn't allow these)
    sanitized = sanitized.replace(/[.\s]+$/, '');
  }

  // Replace consecutive spaces with single space
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // Handle Windows reserved names
  if (platform === 'win32') {
    const upperName = sanitized.toUpperCase().replace(/\.[^.]*$/, ''); // Remove extension
    if (WINDOWS_RESERVED_NAMES.includes(upperName as typeof WINDOWS_RESERVED_NAMES[number])) {
      sanitized = `_${sanitized}`;
    }
  }

  // Truncate to max length
  if (sanitized.length > LIMITS.MAX_FILE_NAME_LENGTH) {
    // Preserve extension if present
    const lastDot = sanitized.lastIndexOf('.');
    if (lastDot > 0 && lastDot > sanitized.length - 10) {
      const ext = sanitized.slice(lastDot);
      const name = sanitized.slice(0, LIMITS.MAX_FILE_NAME_LENGTH - ext.length);
      sanitized = name + ext;
    } else {
      sanitized = sanitized.slice(0, LIMITS.MAX_FILE_NAME_LENGTH);
    }
  }

  // If nothing left, use a default name
  if (sanitized.length === 0) {
    sanitized = 'image';
  }

  return sanitized;
}

/**
 * Check if a string contains dangerous shell characters
 *
 * @param input - The string to check
 * @returns True if dangerous characters are found
 */
export function containsDangerousChars(input: string): boolean {
  return DANGEROUS_SHELL_CHARS.test(input);
}

/**
 * Sanitize a directory path for safe use
 * Removes dangerous characters and normalizes the path
 *
 * @param dirPath - The directory path to sanitize
 * @returns Sanitized directory path
 */
export function sanitizeDirectoryPath(dirPath: string): string {
  let sanitized = dirPath;

  // Remove control characters
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

  // Normalize path separators (always convert backslashes to forward slashes)
  sanitized = sanitized.replace(/\\/g, '/');

  // Remove consecutive separators
  sanitized = sanitized.replace(/\/+/g, '/');

  // Remove leading/trailing separators for relative paths
  sanitized = sanitized.replace(/^\/+|\/+$/g, '');

  return sanitized;
}

/**
 * Escape a string for safe use in shell commands
 * Platform-specific escaping
 *
 * @param input - The string to escape
 * @returns Escaped string
 */
export function escapeShellArg(input: string): string {
  const platform = getPlatform();

  if (platform === 'win32') {
    // For Windows cmd.exe, use double quotes and escape special chars
    // This is a fallback - prefer encodePowerShellCommand for PowerShell
    return `"${input.replace(/"/g, '""')}"`;
  } else {
    // For Unix shells, use single quotes (most characters are literal inside single quotes)
    // Only single quotes need to be escaped
    return `'${input.replace(/'/g, "'\\''")}'`;
  }
}

/**
 * Sanitize error messages to prevent information leakage
 * Removes sensitive paths and tokens
 *
 * @param message - The error message to sanitize
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;

  // Redact user directory paths
  // Windows: C:\Users\username
  sanitized = sanitized.replace(/[A-Za-z]:\\Users\\[^\\]+/gi, '[USER_DIR]');
  // Unix: /home/username or /Users/username
  sanitized = sanitized.replace(/\/(?:home|Users)\/[^/]+/gi, '[USER_DIR]');

  // Redact potential tokens/hashes (32+ hex characters)
  sanitized = sanitized.replace(/[a-f0-9]{32,}/gi, '[REDACTED]');

  // Redact anything that looks like a password or secret
  sanitized = sanitized.replace(/(?:password|secret|token|key|api_key|apikey|auth)\s*[=:]\s*\S+/gi, '[REDACTED]');

  return sanitized;
}
