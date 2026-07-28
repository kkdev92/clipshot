/**
 * Schema-driven configuration for ClipShot
 *
 * Mirrors package.json's contributes.configuration one-to-one. Reads are
 * validated against the schema and cached until VS Code reports a change,
 * so the paste command no longer re-reads every setting from scratch.
 *
 * Numeric ranges are deliberately NOT declared here: a schema violation falls
 * back to the default value, whereas sanitizeConfiguration() clamps the value
 * into range, which stays closer to what the user asked for (e.g. a
 * jpegQuality of 200 becomes 100, not 80). Range checking therefore remains
 * the job of the validators module.
 */

import { defineConfigSchema, field, s } from '@kkdev92/vscode-ext-kit';
import type { ExtensionConfig } from '../core/types';
import { CONFIG_PREFIX, DEFAULTS } from '../core/constants';
import { sanitizeConfiguration } from './validators';

/**
 * Typed accessor for every clipshot.* setting.
 *
 * Keys use the dotted form declared in package.json; VS Code resolves them
 * against the section, so `get('fileName.pattern')` reads
 * `clipshot.fileName.pattern`.
 */
export const config = defineConfigSchema(CONFIG_PREFIX, {
  enabled: field(s.boolean(), DEFAULTS.ENABLED),
  logLevel: field(
    s.enum('trace', 'debug', 'info', 'warn', 'error', 'silent'),
    DEFAULTS.LOG_LEVEL
  ),
  saveDirectory: field(s.string(), DEFAULTS.SAVE_DIRECTORY),
  'fileName.pattern': field(s.string(), DEFAULTS.FILE_NAME_PATTERN),
  'fileName.sequenceDigits': field(
    s.number({ integer: true }),
    DEFAULTS.SEQUENCE_DIGITS
  ),
  'output.format': field(s.enum('png', 'jpeg', 'webp'), DEFAULTS.OUTPUT_FORMAT),
  'output.jpegQuality': field(s.number({ integer: true }), DEFAULTS.JPEG_QUALITY),
  'output.webpQuality': field(s.number({ integer: true }), DEFAULTS.WEBP_QUALITY),
  'resize.mode': field(s.enum('off', 'fit'), DEFAULTS.RESIZE_MODE),
  'resize.maxWidth': field(
    s.nullable(s.number({ integer: true })),
    DEFAULTS.RESIZE_MAX_WIDTH
  ),
  'resize.maxHeight': field(
    s.nullable(s.number({ integer: true })),
    DEFAULTS.RESIZE_MAX_HEIGHT
  ),
  'resize.preset': field(s.nullable(s.enum('ai-optimized')), DEFAULTS.RESIZE_PRESET),
  'insert.format': field(
    s.enum('auto', 'path', 'markdown', 'html'),
    DEFAULTS.INSERT_FORMAT
  ),
  'insert.altSource': field(s.enum('filename', 'literal'), DEFAULTS.ALT_SOURCE),
  'insert.altLiteral': field(s.string(), DEFAULTS.ALT_LITERAL),
  'limits.maxFileSizeMB': field(
    s.number({ integer: true }),
    DEFAULTS.MAX_FILE_SIZE_MB
  ),
  'notifications.level': field(
    s.enum('all', 'errors', 'none'),
    DEFAULTS.NOTIFICATION_LEVEL
  ),
});

/**
 * Load the extension configuration as a single nested object
 *
 * Values are validated by the schema (invalid ones fall back to their
 * default) and then clamped into their documented ranges.
 *
 * @returns Complete extension configuration object
 */
export function loadConfiguration(): ExtensionConfig {
  const raw: ExtensionConfig = {
    enabled: config.get('enabled'),
    logLevel: config.get('logLevel'),
    saveDirectory: config.get('saveDirectory'),
    fileName: {
      pattern: config.get('fileName.pattern'),
      sequenceDigits: config.get('fileName.sequenceDigits'),
    },
    output: {
      format: config.get('output.format'),
      jpegQuality: config.get('output.jpegQuality'),
      webpQuality: config.get('output.webpQuality'),
    },
    resize: {
      mode: config.get('resize.mode'),
      maxWidth: config.get('resize.maxWidth'),
      maxHeight: config.get('resize.maxHeight'),
      preset: config.get('resize.preset'),
    },
    insert: {
      format: config.get('insert.format'),
      altSource: config.get('insert.altSource'),
      altLiteral: config.get('insert.altLiteral'),
    },
    limits: {
      maxFileSizeMB: config.get('limits.maxFileSizeMB'),
    },
    notifications: {
      level: config.get('notifications.level'),
    },
  };

  return { ...raw, ...sanitizeConfiguration(raw) } as ExtensionConfig;
}
