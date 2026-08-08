/**
 * Core type definitions for ClipShot extension
 */

/**
 * Supported operating system platforms
 */
export type Platform = 'win32' | 'darwin' | 'linux';

/**
 * Image output format
 */
export type ImageFormat = 'png' | 'jpeg' | 'webp';

/**
 * Insert text format
 */
export type InsertFormat = 'auto' | 'path' | 'markdown' | 'html';

/**
 * Alt text source
 */
export type AltSource = 'filename' | 'literal';

/**
 * Notification level
 */
export type NotificationLevel = 'all' | 'errors' | 'none';

/**
 * Resize mode
 */
export type ResizeMode = 'off' | 'fit';

/**
 * Resize preset
 */
export type ResizePreset = 'ai-optimized';

/**
 * The logger is the framework's; the level is ours.
 *
 * `clipshot.logLevel` is a setting this extension declares, so its value type
 * belongs here — the framework has no opinion about what levels an extension
 * offers a user, only about the four methods a logger has. `silent` is in the
 * list because turning the channel off is a thing to ask for, and it is not a
 * severity anything is ever logged at.
 */
import type { Logger } from '@kkdev92/vscode-ext-kit';
export type { Logger };

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Clipboard data returned from clipboard providers
 */
export interface ClipboardData {
  /** Whether clipboard contains an image */
  hasImage: boolean;
  /** Whether clipboard contains text */
  hasText: boolean;
  /** Image buffer if available */
  imageBuffer: Buffer | null;
  /** Original image format if detectable */
  format: ImageFormat | null;
}

/**
 * Result of image processing and saving
 */
export interface ProcessedImage {
  /** Absolute path to saved file */
  absolutePath: string;
  /** Relative path from workspace root (./path/to/file.png format) */
  relativePath: string;
  /** File name with extension */
  fileName: string;
  /** File size in bytes */
  fileSize: number;
  /** Actual output format */
  format: ImageFormat;
  /** Image dimensions if available */
  dimensions: ImageDimensions | null;
}

/**
 * Image dimensions
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Extension configuration
 */
export interface ExtensionConfig {
  enabled: boolean;
  logLevel: LogLevel;
  saveDirectory: string;
  fileName: {
    pattern: string;
    sequenceDigits: number;
  };
  output: {
    format: ImageFormat;
    jpegQuality: number;
    webpQuality: number;
  };
  resize: {
    mode: ResizeMode;
    maxWidth: number | null;
    maxHeight: number | null;
    preset: ResizePreset | null;
  };
  insert: {
    format: InsertFormat;
    altSource: AltSource;
    altLiteral: string;
  };
  limits: {
    maxFileSizeMB: number;
  };
  notifications: {
    level: NotificationLevel;
  };
}

/**
 * Recursively optional version of T
 *
 * The configuration validators accept fragments of ExtensionConfig — a single
 * nested group such as `{ output: { jpegQuality } }` — so a shallow
 * `Partial<T>` would still demand every sibling key.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Paste operation result
 */
export interface PasteResult {
  success: boolean;
  processedImage?: ProcessedImage;
  insertedText?: string;
  /** True if path was copied to clipboard (for chat inputs, etc.) */
  copiedToClipboard?: boolean;
  error?: string;
}
