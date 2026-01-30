/**
 * Constants for ClipShot extension
 */

/**
 * Extension identifier used for configuration and commands
 */
export const EXTENSION_ID = 'clipshot';

/**
 * Extension display name
 */
export const EXTENSION_NAME = 'ClipShot';

/**
 * Command identifiers
 */
export const COMMANDS = {
  PASTE_IMAGE: `${EXTENSION_ID}.pasteImage`,
} as const;

/**
 * Context keys for VS Code when clause
 */
export const CONTEXT_KEYS = {
  ENABLED: `${EXTENSION_ID}.enabled`,
} as const;

/**
 * Configuration key prefix
 */
export const CONFIG_PREFIX = EXTENSION_ID;

/**
 * Default configuration values
 */
export const DEFAULTS = {
  ENABLED: true,
  LOG_LEVEL: 'info' as const,
  SAVE_DIRECTORY: '.clipshot',
  FILE_NAME_PATTERN: 'image_${yyyy}${MM}${dd}_${HH}${mm}${ss}_${seq3}',
  SEQUENCE_DIGITS: 3,
  OUTPUT_FORMAT: 'png' as const,
  JPEG_QUALITY: 80,
  WEBP_QUALITY: 80,
  INSERT_FORMAT: 'auto' as const,
  ALT_SOURCE: 'filename' as const,
  ALT_LITERAL: 'image',
  MAX_FILE_SIZE_MB: 10,
  NOTIFICATION_LEVEL: 'all' as const,
} as const;

/**
 * File name pattern tokens
 */
export const PATTERN_TOKENS = {
  YEAR: '${yyyy}',
  MONTH: '${MM}',
  DAY: '${dd}',
  HOUR: '${HH}',
  MINUTE: '${mm}',
  SECOND: '${ss}',
  SEQUENCE: /\$\{seq(\d+)\}/,
} as const;

/**
 * Valid pattern tokens (for validation)
 */
export const VALID_PATTERN_TOKENS = [
  '${yyyy}',
  '${MM}',
  '${dd}',
  '${HH}',
  '${mm}',
  '${ss}',
  // seq tokens are validated with regex
] as const;

/**
 * Limits
 */
export const LIMITS = {
  MIN_SEQUENCE_DIGITS: 1,
  MAX_SEQUENCE_DIGITS: 6,
  MIN_JPEG_QUALITY: 1,
  MAX_JPEG_QUALITY: 100,
  MIN_FILE_SIZE_MB: 1,
  MAX_FILE_SIZE_MB: 100,
  MAX_FILE_NAME_LENGTH: 200,
} as const;

/**
 * Timeouts (in milliseconds)
 */
export const TIMEOUTS = {
  CLIPBOARD_READ: 10000,
  IMAGE_PROCESSING: 30000,
  TEMP_FILE_CLEANUP: 5000,
} as const;

/**
 * PNG file signature (magic bytes)
 */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * JPEG file signature (magic bytes)
 */
export const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Windows reserved file names that need special handling
 */
export const WINDOWS_RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
] as const;

/**
 * Dangerous characters for shell commands (cross-platform)
 */
export const DANGEROUS_SHELL_CHARS = /[`'"$;|&<>(){}[\]!#%^*~?\\]/;

/**
 * Invalid path characters (Windows)
 */
// eslint-disable-next-line no-control-regex
export const INVALID_PATH_CHARS_WINDOWS = /[<>:"|?*\x00-\x1f]/;

/**
 * Invalid path characters (Unix)
 */
// eslint-disable-next-line no-control-regex
export const INVALID_PATH_CHARS_UNIX = /[\x00]/;

/**
 * Temporary file prefix
 */
export const TEMP_FILE_PREFIX = 'clipshot_';

/**
 * Atomic write temporary file suffix
 */
export const ATOMIC_WRITE_SUFFIX = '.tmp';
