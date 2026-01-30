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
export type InsertFormat = 'path' | 'markdown' | 'html';

/**
 * Alt text source
 */
export type AltSource = 'filename' | 'literal';

/**
 * Notification level
 */
export type NotificationLevel = 'all' | 'errors' | 'none';

/**
 * Log level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Logger interface for extension logging
 * Compatible with @kkdev92/vscode-ext-kit logger
 */
export interface Logger {
  /** Log debug level message */
  debug(msg: string, meta?: object): void;
  /** Log info level message */
  info(msg: string, meta?: object): void;
  /** Log warning level message */
  warn(msg: string, meta?: object): void;
  /** Log error level message */
  error(msg: string, error?: unknown): void;
  /** Set the log level */
  setLevel(level: LogLevel): void;
}

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
