/**
 * Extension activation tests
 *
 * Exercises activate()/deactivate() against the vscode mock suite from
 * @kkdev92/vscode-ext-kit/testing — no extension host required.
 *
 * Each test gets a fresh module instance. `defineExtension` is single-use, the
 * way a real extension host uses it: one activation per session, and a second
 * activation after deactivation is refused. `vi.resetModules()` plus a dynamic
 * import per test is what "one session per test" looks like under Vitest — and
 * because `vscode` and the paste-handler mock are re-instantiated with the
 * extension, those are imported dynamically too, so assertions read the same
 * instances the extension saw.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockExtensionContext } from '@kkdev92/vscode-ext-kit/testing';

// The vscode module is mocked globally in test/setup.ts.
vi.mock('../src/keyboard/paste-handler', () => ({
  getPasteHandler: vi.fn(),
}));

import type * as vscodeTypes from 'vscode';
import { COMMANDS, EXTENSION_NAME } from '../src/core/constants';
import type { Logger, PasteResult } from '../src/core/types';

let vscode: typeof import('vscode');
let extension: typeof import('../src/extension');
let pasteHandler: typeof import('../src/keyboard/paste-handler');

function createContext(): vscodeTypes.ExtensionContext {
  return createMockExtensionContext(vi);
}

/**
 * Activate the extension and return the registered paste command handler.
 */
async function activateAndGetPasteCommand(): Promise<() => Promise<void>> {
  // `activate` is asynchronous in the v3 kit: hosted services start inside it.
  // Not awaiting it leaves activation racing the assertions, and racing the
  // `deactivate()` in afterEach — which rejects the in-flight start with
  // `application-stopping`.
  await extension.activate(createContext());

  const call = vi
    .mocked(vscode.commands.registerCommand)
    .mock.calls.find(([id]) => id === COMMANDS.PASTE_IMAGE);
  if (call === undefined) {
    throw new Error('paste command was not registered');
  }
  return call[1] as () => Promise<void>;
}

function stubPasteResult(result: PasteResult): void {
  vi.mocked(pasteHandler.getPasteHandler).mockReturnValue({
    handlePaste: vi.fn().mockResolvedValue(result),
  } as never);
}

/**
 * Answers for `terminal.integrated.commandsToSkipShell`.
 *
 * Activation puts the paste command on that list, which without a stub means
 * every test here writes settings and raises a toast about it. Saying the entry
 * is already there is both quiet and the state an installed extension is in
 * after its first run; the tests that care about the write pass their own list.
 */
function stubTerminalSkipList(entries: readonly string[] = [COMMANDS.PASTE_IMAGE]): {
  update: ReturnType<typeof vi.fn>;
} {
  const update = vi.fn().mockResolvedValue(undefined);
  const forOtherSections = vi.mocked(vscode.workspace.getConfiguration).getMockImplementation();
  vi.mocked(vscode.workspace.getConfiguration).mockImplementation(((section?: string) =>
    section === 'terminal.integrated'
      ? {
          get: vi.fn().mockReturnValue([...entries]),
          inspect: vi.fn().mockReturnValue({ globalValue: [...entries] }),
          update,
        }
      : forOtherSections?.(section)) as never);
  return { update };
}

/** Messages passed to a notification mock, ignoring the options argument. */
function notifiedMessages(mock: unknown): string[] {
  return vi
    .mocked(mock as (...args: unknown[]) => unknown)
    .mock.calls.map((call) => String(call[0]));
}

/** Answers one `clipshot.*` key with `value`; every other key keeps its default. */
function stubSetting(key: string, value: unknown): void {
  const otherwise = vi.mocked(vscode.workspace.getConfiguration).getMockImplementation();
  vi.mocked(vscode.workspace.getConfiguration).mockImplementation(((
    section?: string,
    scope?: vscodeTypes.ConfigurationScope
  ) => {
    const configuration = otherwise?.(section, scope);
    if (section !== 'clipshot' || configuration === undefined) {
      return configuration;
    }
    return {
      ...configuration,
      get: (name: string, fallback?: unknown) =>
        name === key ? value : configuration.get(name, fallback),
    };
  }) as never);
}

/**
 * Tells every configuration listener still subscribed that everything changed.
 *
 * The mock hands each subscription a `dispose` that detaches nothing, so a
 * listener counts as gone once its `dispose` has been called — as it would be
 * in VS Code.
 */
function fireConfigurationChange(): void {
  const event = { affectsConfiguration: () => true } as vscodeTypes.ConfigurationChangeEvent;
  const { calls, results } = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock;
  calls.forEach(([listener], index) => {
    const subscription = results[index]?.value as { dispose: ReturnType<typeof vi.fn> } | undefined;
    if (subscription?.dispose.mock.calls.length === 0) {
      listener(event);
    }
  });
}

/** Messages the log channel received at `level`. */
function logged(level: 'trace' | 'debug' | 'info' | 'warn' | 'error'): string[] {
  const channel = vi.mocked(vscode.window.createOutputChannel).mock.results[0]?.value as
    | Record<string, ReturnType<typeof vi.fn> | undefined>
    | undefined;
  return channel?.[level]?.mock.calls.map((call) => String(call[0])) ?? [];
}

describe('extension', () => {
  beforeEach(async () => {
    // A fresh module registry per test: a new application, a new vscode mock
    // and a new paste-handler mock, all from the same instantiation.
    vi.resetModules();
    vscode = await import('vscode');
    extension = await import('../src/extension');
    pasteHandler = await import('../src/keyboard/paste-handler');
    stubTerminalSkipList();
  });

  afterEach(async () => {
    await extension.deactivate();
    vi.clearAllMocks();
  });

  describe('activate', () => {
    it('registers the paste image command', async () => {
      await extension.activate(createContext());

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        COMMANDS.PASTE_IMAGE,
        expect.any(Function)
      );
    });

    it('logs into a LogOutputChannel named after the application', async () => {
      await extension.activate(createContext());

      // This used to be a plain channel, so that `clipshot.logLevel` was the
      // only thing filtering it. The framework logs into a LogOutputChannel
      // and does no filtering of its own, which is what gives the Output
      // panel's level dropdown and `Developer: Set Log Level` something to act
      // on — and what makes `clipshot.logLevel` a floor on top of VS Code's
      // level rather than the only one. The name is the display name now,
      // because that is what the dropdown shows.
      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(EXTENSION_NAME, {
        log: true,
      });
    });

    it('registers disposables on the extension context', async () => {
      const context = createContext();

      await extension.activate(context);

      expect(context.subscriptions.length).toBeGreaterThan(0);
    });

    it('subscribes to configuration changes', async () => {
      await extension.activate(createContext());

      expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
    });

    it('warns about the configuration at activation, and again when it changes', async () => {
      stubSetting('saveDirectory', '../outside');
      await extension.activate(createContext());
      const warnings = (): number =>
        logged('warn').filter((message) => message.includes('Configuration warning')).length;
      expect(warnings()).toBe(1);

      fireConfigurationChange();

      expect(warnings()).toBe(2);
    });

    it('stops listening for configuration changes once deactivated', async () => {
      await extension.activate(createContext());
      await extension.deactivate();
      const updates = (): number =>
        logged('info').filter((message) => message.includes('Configuration updated')).length;

      fireConfigurationChange();

      expect(updates()).toBe(0);
    });
  });

  describe('terminal shortcut', () => {
    it('puts the paste command on the skip list when it is not there', async () => {
      const { update } = stubTerminalSkipList([]);

      await extension.activate(createContext());

      expect(update).toHaveBeenCalledWith(
        'commandsToSkipShell',
        [COMMANDS.PASTE_IMAGE],
        vscode.ConfigurationTarget.Global
      );
      // A write to someone's settings is not something to do quietly.
      expect(notifiedMessages(vscode.window.showInformationMessage)[0]).toContain(
        'commandsToSkipShell'
      );
    });

    it('writes nothing, and says nothing, when the entry is already there', async () => {
      const { update } = stubTerminalSkipList([COMMANDS.PASTE_IMAGE]);

      await extension.activate(createContext());

      expect(update).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('leaves an explicit opt-out alone', async () => {
      const { update } = stubTerminalSkipList([`-${COMMANDS.PASTE_IMAGE}`]);

      await extension.activate(createContext());

      expect(update).not.toHaveBeenCalled();
    });

    it('registers the command that asks for it by hand', async () => {
      await extension.activate(createContext());

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        COMMANDS.ENABLE_IN_TERMINAL,
        expect.any(Function)
      );
    });

    it('reports the outcome when run by hand, even with nothing to do', async () => {
      stubTerminalSkipList([COMMANDS.PASTE_IMAGE]);
      await extension.activate(createContext());

      const call = vi
        .mocked(vscode.commands.registerCommand)
        .mock.calls.find(([id]) => id === COMMANDS.ENABLE_IN_TERMINAL);
      await (call?.[1] as () => Promise<void>)();

      expect(notifiedMessages(vscode.window.showInformationMessage)[0]).toContain(
        'commandsToSkipShell'
      );
    });
  });

  describe('paste command', () => {
    const processedImage = {
      absolutePath: '/workspace/.clipshot/image_001.png',
      relativePath: './.clipshot/image_001.png',
      fileName: 'image_001.png',
      format: 'png' as const,
      fileSize: 2 * 1024 * 1024,
      dimensions: { width: 800, height: 600 },
    };

    it('reports the saved path when the image was inserted', async () => {
      stubPasteResult({ success: true, processedImage });

      await (await activateAndGetPasteCommand())();

      const [message] = notifiedMessages(vscode.window.showInformationMessage);
      expect(message).toContain('./.clipshot/image_001.png');
      expect(message).toContain('800x600');
      expect(message).toContain('2.00MB');
    });

    it('tells the user to paste manually when the path went to the clipboard', async () => {
      stubPasteResult({ success: true, processedImage, destination: 'clipboard' });

      await (await activateAndGetPasteCommand())();

      expect(notifiedMessages(vscode.window.showInformationMessage)[0]).toContain('Path copied');
    });

    it('says so when the path was typed into the terminal', async () => {
      stubPasteResult({ success: true, processedImage, destination: 'terminal' });

      await (await activateAndGetPasteCommand())();

      expect(notifiedMessages(vscode.window.showInformationMessage)[0]).toContain(
        'typed into the terminal'
      );
    });

    // The keybinding's `when` clause is the only thing that knows where focus
    // is, and it says so through this argument. If it stopped reaching the
    // handler the extension would go back to writing into a background editor,
    // and nothing else here would notice.
    it.each([
      ['{ surface: terminal }', [{ surface: 'terminal' }], 'terminal'],
      ['no arguments (Command Palette)', [], 'editor'],
      ['an argument it does not understand', [{ surface: 'sidebar' }], 'editor'],
      ['a non-object argument', ['terminal'], 'editor'],
    ])('passes the surface through for %s', async (_label, args, expected) => {
      const handlePaste = vi.fn().mockResolvedValue({ success: true, processedImage });
      vi.mocked(pasteHandler.getPasteHandler).mockReturnValue({ handlePaste } as never);

      const command = (await activateAndGetPasteCommand()) as (
        ...args: readonly unknown[]
      ) => Promise<void>;
      await command(...args);

      expect(handlePaste).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expected
      );
    });

    it('surfaces a failure as an error notification', async () => {
      stubPasteResult({ success: false, error: 'No image in clipboard' });

      await (await activateAndGetPasteCommand())();

      expect(notifiedMessages(vscode.window.showErrorMessage)[0]).toContain(
        'No image in clipboard'
      );
    });

    it('stays silent when a failure carries no message', async () => {
      stubPasteResult({ success: false });

      await (await activateAndGetPasteCommand())();

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('stays silent on success without a processed image', async () => {
      stubPasteResult({ success: true });

      await (await activateAndGetPasteCommand())();

      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('resolves without waiting for the notification to be dismissed', async () => {
      // VS Code resolves a notification's thenable when the toast is
      // *dismissed*, so awaiting one bound this command to the user closing a
      // popup. The end-to-end suite, where nobody closes anything, sat through
      // two 60-second timeouts because of it.
      //
      // A notification that never settles stands in for that: the command has
      // to come back anyway.
      stubPasteResult({ success: true, processedImage });
      vi.mocked(vscode.window.showInformationMessage).mockReturnValue(
        new Promise(() => undefined) as never
      );

      const command = await activateAndGetPasteCommand();
      const outcome = await Promise.race([
        command().then(() => 'returned'),
        new Promise((resolve) => setTimeout(() => resolve('still waiting'), 500)),
      ]);

      expect(outcome).toBe('returned');
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });

    it('does not leave a failed notification as an unhandled rejection', async () => {
      // Not awaiting is only half of it. A floating rejection takes the whole
      // run down with a non-zero exit while every test still reports as passed,
      // so the `catch` inside `announce` is load-bearing and gets its own test.
      stubPasteResult({ success: false, error: 'No image in clipboard' });
      vi.mocked(vscode.window.showErrorMessage).mockRejectedValue(new Error('notification gone'));

      const rejections: unknown[] = [];
      const record = (reason: unknown): void => void rejections.push(reason);
      process.on('unhandledRejection', record);
      try {
        await (await activateAndGetPasteCommand())();
        // One turn of the loop is where an unhandled rejection would surface.
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off('unhandledRejection', record);
      }

      expect(rejections).toEqual([]);
    });
  });

  describe('clipshot.logLevel', () => {
    /** A paste that logs one entry at each level through the logger it is handed. */
    function stubLoggingPaste(): void {
      vi.mocked(pasteHandler.getPasteHandler).mockReturnValue({
        handlePaste: vi.fn((_config: unknown, logger: Logger) => {
          logger.trace('probe');
          logger.debug('probe');
          logger.info('probe');
          logger.warn('probe');
          logger.error('probe');
          return Promise.resolve({ success: true });
        }),
      } as never);
    }

    /** The levels at which the probe reached the log channel. */
    function levelsLogged(): string[] {
      return (['trace', 'debug', 'info', 'warn', 'error'] as const).filter((level) =>
        logged(level).some((message) => message.includes('probe'))
      );
    }

    it('passes on only what is at or above the level set', async () => {
      stubSetting('logLevel', 'warn');
      stubLoggingPaste();
      const paste = await activateAndGetPasteCommand();

      await paste();

      expect(levelsLogged()).toEqual(['warn', 'error']);
    });

    it('passes on nothing when silent', async () => {
      stubSetting('logLevel', 'silent');
      stubLoggingPaste();
      const paste = await activateAndGetPasteCommand();

      await paste();

      expect(levelsLogged()).toEqual([]);
    });
  });

  describe('deactivate', () => {
    it('completes without throwing when the extension was activated', async () => {
      await extension.activate(createContext());

      await expect(extension.deactivate()).resolves.toBeUndefined();
    });

    it('completes without throwing when activate was never called', async () => {
      await expect(extension.deactivate()).resolves.toBeUndefined();
    });
  });
});
