/**
 * Extension entry point
 * Uses @kkdev92/vscode-ext-kit for logging, commands, and configuration
 */

import * as vscode from 'vscode';
import {
  createLogger,
  registerCommands,
  getSetting,
  onConfigChange,
  showInfo,
  showError,
  withProgress,
} from '@kkdev92/vscode-ext-kit';
import type { LogLevel } from '@kkdev92/vscode-ext-kit';
import type { ExtensionConfig, ImageFormat, InsertFormat, AltSource, NotificationLevel, ResizeMode, ResizePreset } from './core/types';
import { EXTENSION_ID, COMMANDS, CONTEXT_KEYS, DEFAULTS, CONFIG_PREFIX } from './core/constants';
import { validateConfiguration, sanitizeConfiguration } from './config/validators';
import { getPasteHandler } from './keyboard/paste-handler';
import { disposeGlobalClipboardManager } from './clipboard/clipboard-manager';
import { disposeGlobalTempFileManager } from './security/temp-file-manager';

// Logger instance (initialized in activate)
let logger: ReturnType<typeof createLogger>;

/**
 * Load extension configuration from VS Code settings
 *
 * Reads all clipshot.* settings and applies sanitization
 * to ensure values are within valid ranges.
 *
 * @returns Complete extension configuration object
 */
function loadConfiguration(): ExtensionConfig {
  const config: ExtensionConfig = {
    enabled: getSetting<boolean>(CONFIG_PREFIX, 'enabled', DEFAULTS.ENABLED),
    logLevel: getSetting<LogLevel>(CONFIG_PREFIX, 'logLevel', DEFAULTS.LOG_LEVEL),
    saveDirectory: getSetting<string>(CONFIG_PREFIX, 'saveDirectory', DEFAULTS.SAVE_DIRECTORY),
    fileName: {
      pattern: getSetting<string>(CONFIG_PREFIX, 'fileName.pattern', DEFAULTS.FILE_NAME_PATTERN),
      sequenceDigits: getSetting<number>(CONFIG_PREFIX, 'fileName.sequenceDigits', DEFAULTS.SEQUENCE_DIGITS),
    },
    output: {
      format: getSetting<ImageFormat>(CONFIG_PREFIX, 'output.format', DEFAULTS.OUTPUT_FORMAT),
      jpegQuality: getSetting<number>(CONFIG_PREFIX, 'output.jpegQuality', DEFAULTS.JPEG_QUALITY),
      webpQuality: getSetting<number>(CONFIG_PREFIX, 'output.webpQuality', DEFAULTS.WEBP_QUALITY),
    },
    resize: {
      mode: getSetting<ResizeMode>(CONFIG_PREFIX, 'resize.mode', DEFAULTS.RESIZE_MODE),
      maxWidth: getSetting<number | null>(CONFIG_PREFIX, 'resize.maxWidth', DEFAULTS.RESIZE_MAX_WIDTH),
      maxHeight: getSetting<number | null>(CONFIG_PREFIX, 'resize.maxHeight', DEFAULTS.RESIZE_MAX_HEIGHT),
      preset: getSetting<ResizePreset | null>(CONFIG_PREFIX, 'resize.preset', DEFAULTS.RESIZE_PRESET),
    },
    insert: {
      format: getSetting<InsertFormat>(CONFIG_PREFIX, 'insert.format', DEFAULTS.INSERT_FORMAT),
      altSource: getSetting<AltSource>(CONFIG_PREFIX, 'insert.altSource', DEFAULTS.ALT_SOURCE),
      altLiteral: getSetting<string>(CONFIG_PREFIX, 'insert.altLiteral', DEFAULTS.ALT_LITERAL),
    },
    limits: {
      maxFileSizeMB: getSetting<number>(CONFIG_PREFIX, 'limits.maxFileSizeMB', DEFAULTS.MAX_FILE_SIZE_MB),
    },
    notifications: {
      level: getSetting<NotificationLevel>(CONFIG_PREFIX, 'notifications.level', DEFAULTS.NOTIFICATION_LEVEL),
    },
  };

  // Sanitize configuration
  const sanitized = sanitizeConfiguration(config);
  return { ...config, ...sanitized } as ExtensionConfig;
}

/**
 * Validate configuration and log any issues as warnings
 *
 * This function checks the configuration for invalid values
 * and logs warnings for each issue found. It does not prevent
 * the extension from running with invalid configuration.
 *
 * @param config - The configuration to validate
 */
function validateAndLogConfig(config: ExtensionConfig): void {
  const result = validateConfiguration(config);
  if (!result.valid && logger !== undefined) {
    for (const error of result.errors) {
      logger.warn(`Configuration warning: ${error}`);
    }
  }
}

/**
 * Show success notification if notification level allows
 *
 * @param message - The notification message to display
 * @param level - User configured notification level preference
 */
function notifySuccess(message: string, level: NotificationLevel): void {
  if (level === 'all') {
    void showInfo(message);
  }
}

/**
 * Show error notification if notification level allows
 *
 * @param message - The notification message to display
 * @param level - User configured notification level preference
 */
function notifyError(message: string, level: NotificationLevel): void {
  if (level !== 'none') {
    void showError(message);
  }
}

/**
 * Update VS Code context keys for when clause evaluation
 *
 * Sets context keys that can be used in package.json keybinding
 * "when" clauses to conditionally enable/disable commands.
 *
 * @param config - Current extension configuration
 */
function updateContextKeys(config: ExtensionConfig): void {
  void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.ENABLED, config.enabled);
}

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  // Load initial configuration
  let config = loadConfiguration();

  // Create logger with config section for automatic log level sync
  logger = createLogger(EXTENSION_ID, {
    level: config.logLevel,
    configSection: `${CONFIG_PREFIX}.logLevel`,
  });
  context.subscriptions.push(logger);

  logger.info('Activating extension');

  // Validate configuration
  validateAndLogConfig(config);

  // Update context keys
  updateContextKeys(config);

  // Watch for configuration changes
  context.subscriptions.push(
    onConfigChange(CONFIG_PREFIX, () => {
      config = loadConfiguration();
      validateAndLogConfig(config);
      updateContextKeys(config);
      // Note: logger.setLevel() is not needed here because
      // configSection option enables automatic log level sync
      logger.info('Configuration updated');
    })
  );

  // Get paste handler
  const pasteHandler = getPasteHandler();

  // Register commands
  registerCommands(context, logger, {
    [COMMANDS.PASTE_IMAGE]: async () => {
      const currentConfig = loadConfiguration();
      logger.debug('Paste command triggered');

      // Use withProgress to show progress indicator
      const result = await withProgress(
        'ClipShot',
        async (progress) => {
          progress.report({ message: 'Reading clipboard...' });
          return pasteHandler.handlePaste(currentConfig, logger);
        },
        { cancellable: false }
      );

      if (result.success) {
        if (result.processedImage) {
          const img = result.processedImage;
          const sizeMB = (img.fileSize / (1024 * 1024)).toFixed(2);
          const dims = img.dimensions
            ? `, ${img.dimensions.width}x${img.dimensions.height}`
            : '';

          if (result.copiedToClipboard === true) {
            // Path copied to clipboard - user needs to paste manually
            notifySuccess(
              `Image saved! Path copied - press Ctrl+V to paste: ${img.relativePath}`,
              currentConfig.notifications.level
            );
          } else {
            // Path inserted directly
            notifySuccess(
              `Image saved: ${img.relativePath} (${sizeMB}MB${dims})`,
              currentConfig.notifications.level
            );
          }
        }
      } else if (result.error !== undefined && result.error !== '') {
        notifyError(
          `Paste failed: ${result.error}`,
          currentConfig.notifications.level
        );
      }
    },
  });

  logger.info('Extension activated');
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
  logger.info('Deactivating extension');

  // Clean up resources
  await disposeGlobalClipboardManager();
  await disposeGlobalTempFileManager();

  logger.info('Extension deactivated');
}
