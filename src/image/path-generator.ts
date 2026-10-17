/**
 * Safe path generation for image files
 * Generates unique file names with timestamp and sequence numbers
 */

import * as path from 'path';
import { PATTERN_TOKENS, LIMITS, DEFAULTS } from '../core/constants';
import { sanitizeFileName, truncateUtf8 } from '../security/sanitizer';

/**
 * A file name with `_<n>` before its extension
 *
 * The part before the suffix is shortened if it has to be, so the name stays
 * within the length limit.
 *
 * @param fileName - File name with its extension
 * @param n - The number to add
 * @returns The name with the suffix
 */
export function withNameSuffix(fileName: string, n: number): string {
  const extension = path.extname(fileName);
  const suffix = `_${String(n)}`;
  const base = truncateUtf8(
    fileName.slice(0, fileName.length - extension.length),
    LIMITS.MAX_FILE_NAME_LENGTH - suffix.length
  );
  return base + suffix + extension;
}

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
   * Generate the file name a pattern gives
   *
   * The name can already be taken; `generateFileNames` gives the ones to try
   * after it.
   *
   * @param pattern - The file name pattern with tokens
   * @param extension - The file extension (without dot)
   * @param date - Optional date for timestamps (defaults to now)
   * @param sequenceDigits - Width of `${seq3}` (`clipshot.fileName.sequenceDigits`)
   * @returns Generated file name
   */
  generateFileName(
    pattern: string,
    extension: string,
    date?: Date,
    sequenceDigits: number = DEFAULTS.SEQUENCE_DIGITS
  ): string {
    return this.generateFileNames(pattern, extension, date, sequenceDigits)(0);
  }

  /**
   * Generate the names to try for one save, in order
   *
   * The first is the name the pattern gives. A save never replaces a file, and
   * that name can be taken: a pattern without the seconds repeats, the
   * sequence starts again at 1 every second, and another window can save at
   * the same moment. A pattern with a sequence token then moves on to the next
   * number, which is what the token is for; one without gets `_1`, `_2`, …
   * before the extension.
   *
   * @param pattern - The file name pattern with tokens
   * @param extension - The file extension (without dot)
   * @param date - Optional date for timestamps (defaults to now)
   * @param sequenceDigits - Width of `${seq3}` (`clipshot.fileName.sequenceDigits`)
   * @returns The file name for each attempt, starting at 0
   */
  generateFileNames(
    pattern: string,
    extension: string,
    date?: Date,
    sequenceDigits: number = DEFAULTS.SEQUENCE_DIGITS
  ): (attempt: number) => string {
    const now = date ?? new Date();

    // Replace date/time tokens
    const timed = this.replaceTimeTokens(pattern, now);

    // Sanitize, then add the extension
    const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
    const finish = (name: string): string => sanitizeFileName(name) + normalizedExt;

    const sequence = this.readSequenceToken(timed, now, sequenceDigits);
    if (sequence === null) {
      const name = finish(timed);
      return (attempt) => (attempt === 0 ? name : withNameSuffix(name, attempt));
    }

    const first = finish(sequence.withNumber(sequence.start));
    return (attempt) => {
      if (attempt === 0) {
        return first;
      }
      const next = finish(sequence.withNumber(sequence.start + attempt));
      // A pattern long enough to lose the number to the length limit gives the
      // same name for every number
      return next === first ? withNameSuffix(first, attempt) : next;
    };
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
   * Read the sequence token in a pattern
   *
   * @returns The number this save starts from, and the pattern with a given
   *   number in place of the token; null when the pattern has no token
   */
  private readSequenceToken(
    pattern: string,
    date: Date,
    sequenceDigits: number
  ): { start: number; withNumber: (n: number) => string } | null {
    const match = pattern.match(PATTERN_TOKENS.SEQUENCE);
    if (!match) {
      return null;
    }

    // Get digit count from pattern. `${seq3}` is the token the settings
    // document, and its width is `clipshot.fileName.sequenceDigits`; a token
    // that names another width keeps it.
    const digitCountStr = match[1];
    let digitCount = digitCountStr ? parseInt(digitCountStr, 10) : 3;
    if (digitCount === 3) {
      digitCount = sequenceDigits;
    }

    // Clamp to valid range
    digitCount = Math.max(LIMITS.MIN_SEQUENCE_DIGITS, Math.min(LIMITS.MAX_SEQUENCE_DIGITS, digitCount));

    // Generate sequence key based on timestamp (per-second uniqueness)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;

    // Get next sequence number
    const seqNum = sequenceCache.getNext(key);

    return {
      start: seqNum,
      // Format with leading zeros and replace the token
      withNumber: (n) => pattern.replace(PATTERN_TOKENS.SEQUENCE, this.padZero(n, digitCount)),
    };
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
