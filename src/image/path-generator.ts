/**
 * Safe path generation for image files
 * Generates unique file names with timestamp and sequence numbers
 */

import * as path from 'path';
import { PATTERN_TOKENS, LIMITS } from '../core/constants';
import { sanitizeFileName } from '../security/sanitizer';

/**
 * LRU-style cache for sequence numbers
 * Prevents memory leaks by limiting cache size
 */
class SequenceCache {
  private readonly cache = new Map<string, { value: number; timestamp: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number = 100, ttlMs: number = 5000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Get the next sequence number for a given key
   */
  getNext(key: string): number {
    this.cleanupExpired();

    const entry = this.cache.get(key);
    const now = Date.now();

    if (entry && now - entry.timestamp < this.ttlMs) {
      entry.value++;
      entry.timestamp = now;
      return entry.value;
    }

    // Remove oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value: 1, timestamp: now });
    return 1;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }
}

// Global sequence cache
const sequenceCache = new SequenceCache();

/**
 * Path generator for image files
 */
export class PathGenerator {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Generate a unique file name from a pattern
   *
   * @param pattern - The file name pattern with tokens
   * @param extension - The file extension (without dot)
   * @param date - Optional date for timestamps (defaults to now)
   * @returns Generated file name
   */
  generateFileName(pattern: string, extension: string, date?: Date): string {
    const now = date ?? new Date();

    // Replace date/time tokens
    let result = this.replaceTimeTokens(pattern, now);

    // Replace sequence token
    result = this.replaceSequenceToken(result, now);

    // Sanitize the result
    result = sanitizeFileName(result);

    // Add extension
    const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
    return result + normalizedExt;
  }

  /**
   * Replace date/time tokens in pattern
   */
  private replaceTimeTokens(pattern: string, date: Date): string {
    return pattern
      .replace(PATTERN_TOKENS.YEAR, date.getFullYear().toString())
      .replace(PATTERN_TOKENS.MONTH, this.padZero(date.getMonth() + 1, 2))
      .replace(PATTERN_TOKENS.DAY, this.padZero(date.getDate(), 2))
      .replace(PATTERN_TOKENS.HOUR, this.padZero(date.getHours(), 2))
      .replace(PATTERN_TOKENS.MINUTE, this.padZero(date.getMinutes(), 2))
      .replace(PATTERN_TOKENS.SECOND, this.padZero(date.getSeconds(), 2));
  }

  /**
   * Replace sequence token in pattern
   */
  private replaceSequenceToken(pattern: string, date: Date): string {
    const match = pattern.match(PATTERN_TOKENS.SEQUENCE);
    if (!match) {
      return pattern;
    }

    // Get digit count from pattern
    const digitCountStr = match[1];
    let digitCount = digitCountStr ? parseInt(digitCountStr, 10) : 3;

    // Clamp to valid range
    digitCount = Math.max(LIMITS.MIN_SEQUENCE_DIGITS, Math.min(LIMITS.MAX_SEQUENCE_DIGITS, digitCount));

    // Generate sequence key based on timestamp (per-second uniqueness)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;

    // Get next sequence number
    const seqNum = sequenceCache.getNext(key);

    // Format with leading zeros
    const seqStr = this.padZero(seqNum, digitCount);

    // Replace the token
    return pattern.replace(PATTERN_TOKENS.SEQUENCE, seqStr);
  }

  /**
   * Pad a number with leading zeros
   */
  private padZero(num: number, length: number): string {
    return num.toString().padStart(length, '0');
  }

  /**
   * Generate full save path
   *
   * @param saveDirectory - Relative directory path
   * @param fileName - File name (without path)
   * @returns Full absolute path
   */
  generateSavePath(saveDirectory: string, fileName: string): string {
    // Normalize the save directory
    const normalizedDir = saveDirectory.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

    // Build the full path
    return path.join(this.workspaceRoot, normalizedDir, fileName);
  }

  /**
   * Generate relative path from workspace root
   *
   * @param absolutePath - Absolute file path
   * @returns Relative path with ./ prefix
   */
  generateRelativePath(absolutePath: string): string {
    const relative = path.relative(this.workspaceRoot, absolutePath);
    const normalized = relative.replace(/\\/g, '/');

    // Ensure it starts with ./
    if (!normalized.startsWith('./') && !normalized.startsWith('../')) {
      return './' + normalized;
    }
    return normalized;
  }

  /**
   * Get the workspace root
   */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}

/**
 * Clear the global sequence cache
 *
 * Resets the sequence counter used for generating unique file names.
 * Primarily used for testing to ensure predictable sequence numbers.
 *
 * @internal Exported for testing purposes
 */
export function clearSequenceCache(): void {
  sequenceCache.clear();
}

/**
 * Get the current sequence cache size
 *
 * Returns the number of active entries in the sequence number cache.
 * Useful for monitoring and testing cache behavior.
 *
 * @returns Number of cached sequence entries
 * @internal Exported for testing and diagnostics
 */
export function getSequenceCacheSize(): number {
  return sequenceCache.size;
}
