/**
 * Custom error classes for ClipShot extension
 */

/**
 * Base error class for extension-specific errors
 */
export class ClipShotError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userMessage?: string
  ) {
    super(message);
    this.name = 'ClipShotError';
    // Restore prototype chain (needed for instanceof checks with custom Error classes)
    Object.setPrototypeOf(this, ClipShotError.prototype);
  }
}

/**
 * Error thrown when clipboard operations fail
 */
export class ClipboardError extends ClipShotError {
  constructor(message: string, userMessage?: string) {
    super(message, 'CLIPBOARD_ERROR', userMessage ?? 'Failed to read clipboard');
    this.name = 'ClipboardError';
    Object.setPrototypeOf(this, ClipboardError.prototype);
  }
}

/**
 * Error thrown when no image is found in clipboard
 */
export class NoImageError extends ClipShotError {
  constructor() {
    super('No image found in clipboard', 'NO_IMAGE', 'No image in clipboard');
    this.name = 'NoImageError';
    Object.setPrototypeOf(this, NoImageError.prototype);
  }
}

/**
 * Error thrown when image processing fails
 */
export class ImageProcessingError extends ClipShotError {
  constructor(message: string, userMessage?: string) {
    super(message, 'IMAGE_PROCESSING_ERROR', userMessage ?? 'Failed to process image');
    this.name = 'ImageProcessingError';
    Object.setPrototypeOf(this, ImageProcessingError.prototype);
  }
}

/**
 * Error thrown when file operations fail
 */
export class FileOperationError extends ClipShotError {
  constructor(message: string, userMessage?: string) {
    super(message, 'FILE_OPERATION_ERROR', userMessage ?? 'Failed to save image');
    this.name = 'FileOperationError';
    Object.setPrototypeOf(this, FileOperationError.prototype);
  }
}

/**
 * Error thrown when configuration validation fails
 */
export class ConfigurationError extends ClipShotError {
  constructor(message: string, public readonly invalidFields: string[]) {
    super(message, 'CONFIGURATION_ERROR', 'Invalid configuration');
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Error thrown when path validation fails (security)
 */
export class PathValidationError extends ClipShotError {
  constructor(message: string, userMessage?: string) {
    super(message, 'PATH_VALIDATION_ERROR', userMessage ?? 'Invalid path');
    this.name = 'PathValidationError';
    Object.setPrototypeOf(this, PathValidationError.prototype);
  }
}

/**
 * Error thrown when file size exceeds limit
 */
export class FileSizeLimitError extends ClipShotError {
  constructor(actualSizeMB: number, maxSizeMB: number) {
    super(
      `File size ${actualSizeMB.toFixed(2)}MB exceeds limit ${maxSizeMB}MB`,
      'FILE_SIZE_LIMIT',
      `Image too large (${actualSizeMB.toFixed(1)}MB > ${maxSizeMB}MB)`
    );
    this.name = 'FileSizeLimitError';
    Object.setPrototypeOf(this, FileSizeLimitError.prototype);
  }
}

/**
 * Error thrown when platform is not supported
 */
export class PlatformNotSupportedError extends ClipShotError {
  constructor(platform: string) {
    super(
      `Platform '${platform}' is not supported`,
      'PLATFORM_NOT_SUPPORTED',
      `This platform (${platform}) is not supported`
    );
    this.name = 'PlatformNotSupportedError';
    Object.setPrototypeOf(this, PlatformNotSupportedError.prototype);
  }
}

/**
 * Error thrown when workspace is not available
 */
export class NoWorkspaceError extends ClipShotError {
  constructor() {
    super(
      'No workspace folder is open',
      'NO_WORKSPACE',
      'Please open a folder to use this extension'
    );
    this.name = 'NoWorkspaceError';
    Object.setPrototypeOf(this, NoWorkspaceError.prototype);
  }
}

/**
 * Type guard to check if an error is a ClipShotError
 */
export function isClipShotError(error: unknown): error is ClipShotError {
  return error instanceof ClipShotError;
}

/**
 * Get user-friendly error message from any error
 */
export function getUserErrorMessage(error: unknown): string {
  if (isClipShotError(error)) {
    return error.userMessage ?? error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred';
}
