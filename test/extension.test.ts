/**
 * Extension activation tests
 *
 * Exercises activate()/deactivate() against the vscode mock suite from
 * @kkdev92/vscode-ext-kit/testing — no extension host required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVSCodeMock, createMockExtensionContext } from '@kkdev92/vscode-ext-kit/testing';

// ClipShot reads workspace folders and the clipboard, which are outside the
// library's mock surface (see test/keyboard/paste-handler.test.ts).
vi.mock('vscode', () => {
  const base = createVSCodeMock(vi);
  return {
    ...base,
    window: {
      ...base.window,
      activeTextEditor: undefined,
    },
    workspace: {
      ...base.workspace,
      workspaceFolders: undefined,
    },
    env: {
      ...base.env,
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue(''),
      },
    },
  };
});

vi.mock('../src/keyboard/paste-handler', () => ({
  getPasteHandler: vi.fn(),
}));

import * as vscode from 'vscode';
import { activate, deactivate } from '../src/extension';
import { COMMANDS, CONTEXT_KEYS, EXTENSION_ID } from '../src/core/constants';
import { getPasteHandler } from '../src/keyboard/paste-handler';
import type { PasteResult } from '../src/core/types';

function createContext(): vscode.ExtensionContext {
  return createMockExtensionContext(vi);
}

/**
 * Activate the extension and return the registered paste command handler.
 */
function activateAndGetPasteCommand(): () => Promise<void> {
  activate(createContext());

  const call = vi
    .mocked(vscode.commands.registerCommand)
    .mock.calls.find(([id]) => id === COMMANDS.PASTE_IMAGE);
  if (call === undefined) {
    throw new Error('paste command was not registered');
  }
  return call[1] as () => Promise<void>;
}

function stubPasteResult(result: PasteResult): void {
  vi.mocked(getPasteHandler).mockReturnValue({
    handlePaste: vi.fn().mockResolvedValue(result),
  } as never);
}

/** Messages passed to a notification mock, ignoring the options argument. */
function notifiedMessages(mock: unknown): string[] {
  return vi
    .mocked(mock as (...args: unknown[]) => unknown)
    .mock.calls.map((call) => String(call[0]));
}

describe('extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await deactivate();
    vi.clearAllMocks();
  });

  describe('activate', () => {
    it('registers the paste image command', () => {
      activate(createContext());

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        COMMANDS.PASTE_IMAGE,
        expect.any(Function)
      );
    });

    it('creates a plain output channel named after the extension', () => {
      activate(createContext());

      // No `{ log: true }` second argument: channelMode 'plain' keeps
      // clipshot.logLevel the only filter (a LogOutputChannel would apply
      // VS Code's own log level on top of it).
      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(EXTENSION_ID);
    });

    it('publishes the enabled context key', () => {
      activate(createContext());

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        CONTEXT_KEYS.ENABLED,
        true
      );
    });

    it('registers disposables on the extension context', () => {
      const context = createContext();

      activate(context);

      expect(context.subscriptions.length).toBeGreaterThan(0);
    });

    it('subscribes to configuration changes', () => {
      activate(createContext());

      expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
    });

    it('refreshes the context key when configuration changes', () => {
      activate(createContext());

      // Two listeners are registered: the logger's level sync and the
      // config schema's section watcher. Fire both.
      const listeners = vi
        .mocked(vscode.workspace.onDidChangeConfiguration)
        .mock.calls.map((call) => call[0]);
      expect(listeners.length).toBeGreaterThan(0);

      vi.mocked(vscode.commands.executeCommand).mockClear();
      const event = { affectsConfiguration: () => true } as vscode.ConfigurationChangeEvent;
      for (const listener of listeners) {
        listener(event);
      }

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        CONTEXT_KEYS.ENABLED,
        true
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

      await activateAndGetPasteCommand()();

      const [message] = notifiedMessages(vscode.window.showInformationMessage);
      expect(message).toContain('./.clipshot/image_001.png');
      expect(message).toContain('800x600');
      expect(message).toContain('2.00MB');
    });

    it('tells the user to paste manually when the path went to the clipboard', async () => {
      stubPasteResult({ success: true, processedImage, copiedToClipboard: true });

      await activateAndGetPasteCommand()();

      expect(notifiedMessages(vscode.window.showInformationMessage)[0]).toContain(
        'Path copied'
      );
    });

    it('surfaces a failure as an error notification', async () => {
      stubPasteResult({ success: false, error: 'No image in clipboard' });

      await activateAndGetPasteCommand()();

      expect(notifiedMessages(vscode.window.showErrorMessage)[0]).toContain(
        'No image in clipboard'
      );
    });

    it('stays silent when a failure carries no message', async () => {
      stubPasteResult({ success: false });

      await activateAndGetPasteCommand()();

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('stays silent on success without a processed image', async () => {
      stubPasteResult({ success: true });

      await activateAndGetPasteCommand()();

      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('completes without throwing when the extension was activated', async () => {
      activate(createContext());

      await expect(deactivate()).resolves.toBeUndefined();
    });

    it('completes without throwing when activate was never called', async () => {
      await expect(deactivate()).resolves.toBeUndefined();
    });
  });
});
