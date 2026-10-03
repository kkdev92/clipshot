/**
 * Extension entry point.
 *
 * The whole of what this extension contributes is declared here as one module
 * — two commands, a settings block and three hosted services — and compiled
 * into a plan before VS Code is touched. `defineExtension` runs it; nothing in this
 * file registers or disposes anything by hand.
 *
 * The work itself is unchanged. Clipboard access, image processing and path
 * safety live where they always did; this file is only how they are reached.
 */

import {
  Notifications,
  defineCommandContract,
  defineExtension,
  defineModule,
  filterLogger,
  type OperationContext,
  type Validator,
} from '@kkdev92/vscode-ext-kit';

import { Settings, loadConfiguration } from './config/schema';
import { validateConfiguration } from './config/validators';
import { COMMANDS, EXTENSION_NAME } from './core/constants';
import { disposeGlobalClipboardManager } from './clipboard/clipboard-manager';
import { getPasteHandler } from './keyboard/paste-handler';
import { describeSkipShellOutcome, ensureSkipShellEntry } from './terminal/skip-shell';
import { disposeGlobalTempFileManager } from './security/temp-file-manager';
import type {
  ExtensionConfig,
  Logger,
  NotificationLevel,
  PasteDestination,
  PasteSurface,
} from './core/types';

/** The one thing a keybinding may tell the paste command. */
export interface PasteImageArgs {
  /** Which pane the shortcut was pressed in. */
  readonly surface: PasteSurface;
}

/**
 * Normalises whatever a caller passed into a surface.
 *
 * Never fails. The framework turns a rejected argument into a thrown command,
 * and there is nothing here worth failing a paste over: the manifest supplies
 * `{ surface: 'terminal' }` from one keybinding, the Command Palette supplies
 * nothing, and anything else is a caller this extension did not write. All
 * three want the same answer — the editor unless the terminal was named.
 */
const pasteImageArgs: Validator<readonly [PasteImageArgs]> = {
  validate: (value: unknown) => {
    const first = value instanceof Array ? (value as readonly unknown[])[0] : undefined;
    const named =
      typeof first === 'object' && first !== null
        ? (first as { readonly surface?: unknown }).surface
        : undefined;
    return { ok: true, value: [{ surface: named === 'terminal' ? 'terminal' : 'editor' }] };
  },
};

/**
 * The paste command.
 *
 * The result is a file and an edit rather than a value a caller reads, so there
 * is none. The argument exists because VS Code has no runtime API for focus:
 * `window.activeTextEditor` names the last edited editor whether or not it has
 * focus, so "is the terminal focused?" can only be answered by the keybinding's
 * own `when` clause, which answers it by passing this.
 */
export const PasteImage = defineCommandContract<readonly [PasteImageArgs], void>(
  { id: COMMANDS.PASTE_IMAGE },
  { args: pasteImageArgs }
);

/**
 * The terminal registration, as something a user can run.
 *
 * It is the same work activation does, exposed because the automatic pass is
 * skippable: a user who turned `clipshot.terminal.registerShortcut` off, or
 * whose settings could not be written the first time, needs a way to ask for it
 * without hunting through settings.json.
 */
export const EnableInTerminal = defineCommandContract<readonly [], void>({
  id: COMMANDS.ENABLE_IN_TERMINAL,
});

/** Logs every configuration problem as a warning, without refusing to run. */
function warnAboutConfig(config: ExtensionConfig, logger: Logger): void {
  const result = validateConfiguration(config);
  if (!result.valid) {
    for (const error of result.errors) {
      logger.warn('Configuration warning', { issue: error });
    }
  }
}

/** Whether a notification of this kind should be shown at all. */
function wants(level: NotificationLevel, kind: 'success' | 'error'): boolean {
  return kind === 'success' ? level === 'all' : level !== 'none';
}

/** What to say after a paste that worked. */
function describeSuccess(result: {
  processedImage: { relativePath: string; fileSize: number; dimensions?: { width: number; height: number } | undefined };
  destination?: PasteDestination | undefined;
}): string {
  const image = result.processedImage;
  if (result.destination === 'clipboard') {
    // Nothing received the path, so the message has to say what to do next.
    return `Image saved! Path copied - press Ctrl+V to paste: ${image.relativePath}`;
  }
  if (result.destination === 'terminal') {
    // Worth naming: the path was typed rather than run, and the cursor is
    // sitting right after it.
    return `Image saved and path typed into the terminal: ${image.relativePath}`;
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
    execute: async (context: OperationContext, [args], { settings }): Promise<void> => {
      const config = loadConfiguration(settings);
      // clipshot.logLevel is a floor on top of the channel's own level: VS Code
      // owns that level, and an extension cannot raise it.
      const logger = filterLogger(context.logger, config.logLevel);

      // Read per invocation rather than held from activation: a setting the
      // user changed a moment ago should apply to this paste, and the accessor
      // is what makes that free.
      const result = await context.progress.run(
        { title: 'ClipShot', cancellable: false },
        async (progress) => {
          progress.report({ message: 'Reading clipboard...' });
          return getPasteHandler().handlePaste(config, logger, args.surface);
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

  module.commands.handle(EnableInTerminal, {
    inject: { settings: Settings.token },
    execute: async (context: OperationContext, _args, { settings }): Promise<void> => {
      const config = loadConfiguration(settings);
      const logger = filterLogger(context.logger, config.logLevel);
      const outcome = await ensureSkipShellEntry(COMMANDS.PASTE_IMAGE, logger);
      const message = describeSkipShellOutcome(outcome);
      // Run by hand, so the result is reported whatever it is and whatever the
      // notification level says: someone who asked the question is owed the
      // answer, including the two answers that are not "done".
      announce(
        outcome === 'failed' || outcome === 'opted-out'
          ? context.notify.warn(message)
          : context.notify.info(message),
        logger
      );
    },
  });

  // Configuration is read where it is used, so nothing here caches it. What
  // this service exists for is the one effect a change has outside a paste:
  // the warnings.
  module.hostedServices.add({
    id: 'clipshot.configuration',
    inject: { settings: Settings.token },
    start: (context, { settings }) => {
      const apply = (): void => {
        const config = loadConfiguration(settings);
        warnAboutConfig(config, filterLogger(context.logger, config.logLevel));
      };
      apply();
      // `onDidChange` fires for the section as a whole. Every key here feeds
      // the warnings, so there is nothing to filter on — `watch` per key would
      // be sixteen subscriptions doing one job.
      const subscription = settings.onDidChange(() => {
        context.logger.info('Configuration updated');
        apply();
      });
      // Released through the signal, which aborts however the application ends.
      context.signal.addEventListener('abort', () => {
        subscription.dispose();
      });
    },
  });

  // Ctrl+Shift+V does not reach an extension while the integrated terminal has
  // focus unless the command is on VS Code's skip list, and VS Code has no
  // contribution point for that list — the reasoning, and why this only started
  // mattering, is in src/terminal/skip-shell.ts. Activation is where the write
  // belongs: it is the last moment before a user reaches for the shortcut.
  module.hostedServices.add({
    id: 'clipshot.terminalShortcut',
    inject: { settings: Settings.token, notifications: Notifications },
    start: async (context, { settings, notifications }) => {
      // Settled once the list has an answer in it. 'failed' is the one outcome
      // left unsettled: a settings.json that could not be written now may be
      // writable later, and a change event is a reasonable moment to retry.
      let settled = false;
      const apply = async (): Promise<void> => {
        const config = loadConfiguration(settings);
        if (settled || !config.terminal.registerShortcut) {
          return;
        }
        const logger = filterLogger(context.logger, config.logLevel);
        const outcome = await ensureSkipShellEntry(COMMANDS.PASTE_IMAGE, logger);
        settled = outcome !== 'failed';
        if (outcome === 'added' && wants(config.notifications.level, 'success')) {
          // Writing to a user's settings without telling them is the worse
          // trade. It fires once in the life of an installation.
          announce(notifications.info(describeSkipShellOutcome(outcome)), logger);
        }
      };
      await apply();
      // Stopped while that ran: a subscription made now would outlive the stop.
      if (context.signal.aborted) {
        return;
      }
      // Turning the setting on is a request, not a preference to note for next
      // time, so it is acted on when it happens rather than at the next start.
      const subscription = settings.onDidChange(() => {
        void apply();
      });
      context.signal.addEventListener('abort', () => {
        subscription.dispose();
      });
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
