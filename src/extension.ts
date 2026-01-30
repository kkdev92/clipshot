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
} from '@kkdev92/vscode-ext-kit';
import type { ExtensionConfig, LogLevel, ImageFormat, InsertFormat, AltSource, NotificationLevel } from './core/types';
import { EXTENSION_ID, COMMANDS, CONTEXT_KEYS, DEFAULTS, CONFIG_PREFIX } from './core/constants';
import { validateConfiguration, sanitizeConfiguration } from './config/validators';
import { getPasteHandler } from './keyboard/paste-handler';
import { disposeGlobalClipboardManager } from './clipboard/clipboard-manager';
import { disposeGlobalTempFileManager } from './security/temp-file-manager';

// Logger instance
let logger: ReturnType<typeof createLogger> | null = null;

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
  if (!result.valid && logger) {
    for (const error of result.errors) {
      logger.warn(`Configuration warning: ${error}`);
    }
  }
}

/**
 * Show notification based on user's notification level setting
 *
 * Respects the user's preference for notification verbosity:
 * - 'all': Show both info and error notifications
 * - 'errors': Only show error notifications
 * - 'none': Suppress all notifications
 *
 * @param message - The notification message to display
 * @param type - Notification type ('info' for success, 'error' for failures)
 * @param level - User configured notification level preference
 */
function showNotification(
  message: string,
  type: 'info' | 'error',
  level: NotificationLevel
): void {
  if (level === 'none') {
    return;
  }
  if (level === 'errors' && type !== 'error') {
    return;
  }

  if (type === 'error') {
    void vscode.window.showErrorMessage(message);
  } else {
    void vscode.window.showInformationMessage(message);
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

  // Create logger
  logger = createLogger(EXTENSION_ID, {
    level: config.logLevel,
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
      logger?.setLevel(config.logLevel);
      logger?.info('Configuration updated');
    })
  );

  // Get paste handler
  const pasteHandler = getPasteHandler();

  // Register commands
  registerCommands(context, logger, {
    [COMMANDS.PASTE_IMAGE]: async () => {
      if (!logger) {
        return;
      }

      const currentConfig = loadConfiguration();
      logger.debug('Paste command triggered');

      const result = await pasteHandler.handlePaste(currentConfig, logger);

      if (result.success) {
        if (result.processedImage) {
          const img = result.processedImage;
          const sizeMB = (img.fileSize / (1024 * 1024)).toFixed(2);
          const dims = img.dimensions
            ? `, ${img.dimensions.width}x${img.dimensions.height}`
            : '';

          if (result.copiedToClipboard === true) {
            // Path copied to clipboard - user needs to paste manually
            showNotification(
              `Image saved! Path copied - press Ctrl+V to paste: ${img.relativePath}`,
              'info',
              currentConfig.notifications.level
            );
          } else {
            // Path inserted directly
            showNotification(
              `Image saved: ${img.relativePath} (${sizeMB}MB${dims})`,
              'info',
              currentConfig.notifications.level
            );
          }
        }
      } else if (result.error !== undefined && result.error !== '') {
        showNotification(
          `Paste failed: ${result.error}`,
          'error',
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
  logger?.info('Deactivating extension');

  // Clean up resources
  await disposeGlobalClipboardManager();
  await disposeGlobalTempFileManager();

  logger?.info('Extension deactivated');
}
