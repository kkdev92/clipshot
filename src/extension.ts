/**
 * Extension entry point.
 *
 * The whole of what this extension contributes is declared here as one module
 * — a command, a settings block and two hosted services — and compiled into a
 * plan before VS Code is touched. `defineExtension` runs it; nothing in this
 * file registers or disposes anything by hand.
 *
 * The work itself is unchanged. Clipboard access, image processing and path
 * safety live where they always did; this file is only how they are reached.
 */

import * as vscode from 'vscode';

import {
  defineCommandContract,
  defineExtension,
  defineModule,
  type OperationContext,
} from '@kkdev92/vscode-ext-kit';

import { Settings, loadConfiguration } from './config/schema';
import { validateConfiguration } from './config/validators';
import { COMMANDS, CONTEXT_KEYS, EXTENSION_NAME } from './core/constants';
import { disposeGlobalClipboardManager } from './clipboard/clipboard-manager';
import { getPasteHandler } from './keyboard/paste-handler';
import { disposeGlobalTempFileManager } from './security/temp-file-manager';
import type { ExtensionConfig, LogLevel, Logger, NotificationLevel } from './core/types';

/**
 * The paste command.
 *
 * No arguments and no result: it is a keybinding and a palette entry, and what
 * it produces is a file and an edit rather than a value a caller reads.
 */
export const PasteImage = defineCommandContract<readonly [], void>({
  id: COMMANDS.PASTE_IMAGE,
});

/** Severity order, for comparing against the configured floor. */
const SEVERITY: Record<Exclude<LogLevel, 'silent'>, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

/**
 * Applies `clipshot.logLevel` on top of the channel's own level.
 *
 * The framework logs into a `LogOutputChannel`, which VS Code filters by the
 * level chosen in the Output panel — so unlike before, this setting can only
 * make the log quieter, never louder. It is kept because "stop logging at all"
 * (`silent`) and "only warnings and worse" are things a user asks for and the
 * panel's dropdown is easy to miss; what it can no longer do is turn on `debug`
 * output that VS Code is filtering out one level up.
 */
function filtered(logger: Logger, level: LogLevel): Logger {
  if (level === 'trace') {
    return logger;
  }
  const floor = level === 'silent' ? Number.POSITIVE_INFINITY : SEVERITY[level];
  const passes = (of: Exclude<LogLevel, 'silent'>): boolean => SEVERITY[of] >= floor;
  return {
    trace: (message, fields): void => {
      if (passes('trace')) {
        logger.trace(message, fields);
      }
    },
    debug: (message, fields): void => {
      if (passes('debug')) {
        logger.debug(message, fields);
      }
    },
    info: (message, fields): void => {
      if (passes('info')) {
        logger.info(message, fields);
      }
    },
    warn: (message, fields): void => {
      if (passes('warn')) {
        logger.warn(message, fields);
      }
    },
    error: (message, error, fields): void => {
      if (passes('error')) {
        logger.error(message, error, fields);
      }
    },
    withFields: (fields): Logger => filtered(logger.withFields(fields), level),
  };
}

/** Logs every configuration problem as a warning, without refusing to run. */
function warnAboutConfig(config: ExtensionConfig, logger: Logger): void {
  const result = validateConfiguration(config);
  if (!result.valid) {
    for (const error of result.errors) {
      logger.warn('Configuration warning', { issue: error });
    }
  }
}

/**
 * Mirrors `enabled` into a context key.
 *
 * `setContext` is the only way a `when` clause in package.json can see a
 * setting, and there is no capability for it — a command is how VS Code
 * exposes it, so this is the one place the extension calls one directly.
 *
 * A failure here is reported and swallowed rather than propagated. The caller
 * is a settings-change listener and an activation path, and neither has a way
 * to act on it: the extension is still usable with a stale `when` clause, and
 * failing activation over a menu item's visibility would be the worse outcome.
 * It matters in practice because `setContext` is a VS Code built-in rather than
 * something this extension registers, so a test double that only knows
 * registered commands rejects it.
 */
async function publishContextKeys(config: ExtensionConfig, logger: Logger): Promise<void> {
  try {
    await vscode.commands.executeCommand('setContext', CONTEXT_KEYS.ENABLED, config.enabled);
  } catch (error) {
    logger.debug('Could not publish the context key', {
      key: CONTEXT_KEYS.ENABLED,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Whether a notification of this kind should be shown at all. */
function wants(level: NotificationLevel, kind: 'success' | 'error'): boolean {
  return kind === 'success' ? level === 'all' : level !== 'none';
}

/** What to say after a paste that worked. */
function describeSuccess(result: {
  processedImage: { relativePath: string; fileSize: number; dimensions?: { width: number; height: number } | undefined };
  copiedToClipboard?: boolean | undefined;
}): string {
  const image = result.processedImage;
  if (result.copiedToClipboard === true) {
    // The path went to the clipboard because there was no editor to insert
    // into, so the message has to say what to do next.
    return `Image saved! Path copied - press Ctrl+V to paste: ${image.relativePath}`;
  }
  const sizeMB = (image.fileSize / (1024 * 1024)).toFixed(2);
  const dims =
    image.dimensions === undefined
      ? ''
      : `, ${String(image.dimensions.width)}x${String(image.dimensions.height)}`;
  return `Image saved: ${image.relativePath} (${sizeMB}MB${dims})`;
}

/**
 * Show a notification without waiting for it.
 *
 * VS Code resolves a notification's thenable when the toast is *dismissed*, not
 * when it appears. Awaiting one therefore binds the paste command's own promise
 * to the user closing a popup — `executeCommand('clipshot.pasteImage')` would
 * not resolve until then. The end-to-end suite, where nobody dismisses
 * anything, timed out on exactly that.
 *
 * Nothing here reads which button was pressed, so there is nothing to wait for.
 * The `catch` is not decoration: a floating rejection takes the process down
 * with a non-zero exit even when every test passed.
 */
function announce(notification: Promise<unknown>, logger: Logger): void {
  notification.catch((error: unknown) => {
    logger.warn(`Notification failed: ${String(error)}`);
  });
}

export const clipshot = defineModule('clipshot', (module): undefined => {
  module.settings.add(Settings);

  module.commands.handle(PasteImage, {
    inject: { settings: Settings.token },
    execute: async (context: OperationContext, _args, { settings }): Promise<void> => {
      const config = loadConfiguration(settings);
      const logger = filtered(context.logger, config.logLevel);

      // Read per invocation rather than held from activation: a setting the
      // user changed a moment ago should apply to this paste, and the accessor
      // is what makes that free.
      const result = await context.progress.run(
        { title: 'ClipShot', cancellable: false },
        async (progress) => {
          progress.report({ message: 'Reading clipboard...' });
          return getPasteHandler().handlePaste(config, logger);
        }
      );

      if (result.success) {
        if (result.processedImage !== undefined && wants(config.notifications.level, 'success')) {
          announce(
            context.notify.info(describeSuccess(result as Parameters<typeof describeSuccess>[0])),
            logger
          );
        }
        return;
      }

      if (
        result.error !== undefined &&
        result.error !== '' &&
        wants(config.notifications.level, 'error')
      ) {
        announce(context.notify.error(`Paste failed: ${result.error}`), logger);
      }
    },
  });

  // Configuration is read where it is used, so nothing here caches it. What
  // this service exists for is the two effects a change has outside a paste:
  // the context key a `when` clause reads, and the warnings.
  let subscription: { dispose(): void } | undefined;
  module.hostedServices.add({
    id: 'clipshot.configuration',
    inject: { settings: Settings.token },
    start: async (context, { settings }) => {
      const apply = async (): Promise<void> => {
        const config = loadConfiguration(settings);
        const logger = filtered(context.logger, config.logLevel);
        warnAboutConfig(config, logger);
        await publishContextKeys(config, logger);
      };
      // Awaited here so the context key is set before activation reports done;
      // `publishContextKeys` swallows its own failure, so this cannot reject.
      await apply();
      // `onDidChange` fires for the section as a whole. Every key here feeds
      // either the context key or the warnings, so there is nothing to filter
      // on — `watch` per key would be sixteen subscriptions doing one job.
      subscription = settings.onDidChange(() => {
        context.logger.info('Configuration updated');
        void apply();
      });
    },
    stop: () => {
      subscription?.dispose();
      subscription = undefined;
    },
  });

  // The clipboard manager holds a native handle and the temp file manager owns
  // files on disk; both are torn down asynchronously. That is the whole reason
  // this is a hosted service rather than a disposable: VS Code does not await
  // an async `dispose()`, and a hosted service's `stop` is awaited.
  module.hostedServices.add({
    id: 'clipshot.resources',
    start: () => undefined,
    stop: async () => {
      await disposeGlobalClipboardManager();
      await disposeGlobalTempFileManager();
    },
  });

  return undefined;
});

export const app = defineExtension({
  name: EXTENSION_NAME,
  modules: [clipshot],
});

export const activate = app.activate;
export const deactivate = app.deactivate;
