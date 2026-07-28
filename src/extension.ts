/**
 * Extension entry point
 * Uses @kkdev92/vscode-ext-kit for logging, commands, and configuration
 */

import * as vscode from 'vscode';
import {
  createExtensionKit,
  showInfo,
  showError,
  withProgress,
} from '@kkdev92/vscode-ext-kit';
import type { ExtensionKit } from '@kkdev92/vscode-ext-kit';
import type { ExtensionConfig, Logger, NotificationLevel } from './core/types';
import { EXTENSION_ID, COMMANDS, CONTEXT_KEYS, CONFIG_PREFIX } from './core/constants';
import { validateConfiguration } from './config/validators';
import { config, loadConfiguration } from './config/schema';
import { getPasteHandler } from './keyboard/paste-handler';
import { disposeGlobalClipboardManager } from './clipboard/clipboard-manager';
import { disposeGlobalTempFileManager } from './security/temp-file-manager';

/** Command IDs this extension registers */
type ClipShotCommandId = typeof COMMANDS.PASTE_IMAGE;

// Logger instance (initialized in activate)
let logger: Logger | undefined;

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
      logger.warn('Configuration warning', { issue: error });
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
 * Handle a completed paste operation by notifying the user
 *
 * @param kit - The extension kit (for logging)
 * @param currentConfig - Configuration in effect for this paste
 */
async function runPasteCommand(
  kit: ExtensionKit<ClipShotCommandId>,
  currentConfig: ExtensionConfig
): Promise<void> {
  const pasteHandler = getPasteHandler();

  // Use withProgress to show progress indicator
  const result = await withProgress(
    'ClipShot',
    async (progress) => {
      progress.report({ message: 'Reading clipboard...' });
      return pasteHandler.handlePaste(currentConfig, kit.logger);
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
}

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  // Load initial configuration
  let currentConfig = loadConfiguration();

  // One call wires the logger, a disposable scope and command registration.
  // channelMode 'plain' keeps clipshot.logLevel the single source of truth:
  // a LogOutputChannel would additionally filter by VS Code's own log level,
  // which cannot be set programmatically.
  const kit = createExtensionKit<ClipShotCommandId>(context, EXTENSION_ID, {
    logger: {
      level: currentConfig.logLevel,
      channelMode: 'plain',
      configSection: `${CONFIG_PREFIX}.logLevel`,
    },
  });
  logger = kit.logger;

  logger.info('Activating extension');

  // Validate configuration
  validateAndLogConfig(currentConfig);

  // Update context keys
  updateContextKeys(currentConfig);

  // Watch for configuration changes
  kit.disposables.add(
    config.onDidChangeAny(() => {
      currentConfig = loadConfiguration();
      validateAndLogConfig(currentConfig);
      updateContextKeys(currentConfig);
      // Note: logger.setLevel() is not needed here because
      // configSection option enables automatic log level sync
      logger?.info('Configuration updated');
    })
  );

  // Register commands
  kit.registerCommands({
    [COMMANDS.PASTE_IMAGE]: async () => {
      kit.logger.debug('Paste command triggered');
      await runPasteCommand(kit, currentConfig);
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
  logger = undefined;
}
