/**
 * PasteHandler unit tests
 * Tests the paste workflow orchestration with VS Code API mocks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockLogger } from '@kkdev92/vscode-ext-kit/testing';
import type { ExtensionConfig, ProcessedImage, Logger, ClipboardData } from '../../src/core/types';

// The vscode module is mocked globally in test/setup.ts.

// Mock clipboard manager
vi.mock('../../src/clipboard/clipboard-manager', () => ({
  getClipboardManager: vi.fn(),
}));

// Mock image processor
vi.mock('../../src/image/image-processor', () => ({
  ImageProcessor: vi.fn(),
}));

import * as vscode from 'vscode';
import { PasteHandler, getPasteHandler } from '../../src/keyboard/paste-handler';
import { getClipboardManager } from '../../src/clipboard/clipboard-manager';
import { ImageProcessor } from '../../src/image/image-processor';

// Create mock config
function createMockConfig(overrides: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    enabled: true,
    logLevel: 'info',
    saveDirectory: '.clipshot',
    fileName: {
      pattern: 'image_${seq3}',
      sequenceDigits: 3,
    },
    output: {
      format: 'png',
      jpegQuality: 80,
      webpQuality: 80,
    },
    resize: {
      mode: 'off',
      maxWidth: null,
      maxHeight: null,
      preset: null,
    },
    insert: {
      format: 'auto',
      altSource: 'filename',
      altLiteral: 'image',
    },
    limits: {
      maxFileSizeMB: 10,
    },
    notifications: {
      level: 'all',
    },
    terminal: {
      registerShortcut: true,
      target: 'terminal',
    },
    ...overrides,
  };
}

/** A terminal for `window.activeTerminal`, recording what was sent to it. */
function createMockTerminal(): { sendText: ReturnType<typeof vi.fn> } {
  return { sendText: vi.fn() };
}

/** The arrangement every "the image was saved" test needs. */
function arrangeSavedImage(
  clipboard: { getImageData: ReturnType<typeof vi.fn>; cleanup: ReturnType<typeof vi.fn> },
  processor: { processAndSave: ReturnType<typeof vi.fn> },
  processedImage: ProcessedImage
): void {
  (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
    { uri: { fsPath: '/workspace' } },
  ];
  clipboard.getImageData.mockResolvedValue(createMockClipboardData(true));
  clipboard.cleanup.mockResolvedValue(undefined);
  processor.processAndSave.mockResolvedValue(processedImage);
}

/** An editor that records whether anything tried to write into it. */
function createMockEditor(languageId: string): {
  document: { languageId: string };
  selections: unknown[];
  edit: ReturnType<typeof vi.fn>;
} {
  return {
    document: { languageId },
    selections: [{ isEmpty: true, active: { line: 0, character: 0 } }],
    edit: vi.fn().mockResolvedValue(true),
  };
}

// Create mock processed image
function createMockProcessedImage(): ProcessedImage {
  return {
    absolutePath: '/workspace/.clipshot/image_001.png',
    relativePath: './.clipshot/image_001.png',
    fileName: 'image_001.png',
    format: 'png',
    fileSize: 1024,
    dimensions: { width: 100, height: 100 },
  };
}

// Create mock clipboard data
function createMockClipboardData(hasImage: boolean = true): ClipboardData {
  return {
    hasImage,
    hasText: false,
    imageBuffer: hasImage ? Buffer.from([0x89, 0x50, 0x4e, 0x47]) : null,
    format: hasImage ? 'png' : null,
  };
}

describe('PasteHandler', () => {
  let handler: PasteHandler;
  let mockLogger: Logger;
  let mockClipboardManager: {
    getImageData: ReturnType<typeof vi.fn>;
    cleanup: ReturnType<typeof vi.fn>;
    hasImage: ReturnType<typeof vi.fn>;
  };
  let mockImageProcessor: {
    processAndSave: ReturnType<typeof vi.fn>;
    isSharpAvailable: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    handler = new PasteHandler();
    mockLogger = createMockLogger(vi);

    // Setup clipboard manager mock
    mockClipboardManager = {
      getImageData: vi.fn(),
      cleanup: vi.fn(),
      hasImage: vi.fn(),
    };
    vi.mocked(getClipboardManager).mockReturnValue(mockClipboardManager as never);

    // Setup image processor mock
    mockImageProcessor = {
      processAndSave: vi.fn(),
      isSharpAvailable: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(ImageProcessor).mockImplementation(function () { return mockImageProcessor; } as never);

    // Reset vscode mocks
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
    // Not part of the kit's vscode mock, so it is set here rather than cleared.
    (vscode.window as { activeTerminal?: unknown }).activeTerminal = undefined;
    (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = undefined;
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
    vi.mocked(vscode.env.clipboard.writeText).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handlePaste', () => {
    it('should return error when extension is disabled', async () => {
      const config = createMockConfig({ enabled: false });
      vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(true); // Fallback to standard paste
      expect(mockLogger.debug).toHaveBeenCalledWith('Extension is disabled');
    });

    it('should prevent concurrent processing', async () => {
      const config = createMockConfig();

      // Setup workspace
      (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
        { uri: { fsPath: '/workspace' } },
      ];

      // Setup slow clipboard operation
      mockClipboardManager.getImageData.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(createMockClipboardData()), 100))
      );
      mockClipboardManager.cleanup.mockResolvedValue(undefined);

      // Start first paste (don't await)
      const firstPaste = handler.handlePaste(config, mockLogger);

      // Try second paste while first is in progress
      const secondResult = await handler.handlePaste(config, mockLogger);

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toBe('Paste already in progress');

      // Cleanup first paste
      await firstPaste;
    });

    it('should return error when no workspace is open', async () => {
      const config = createMockConfig();
      (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = undefined;

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('folder');
      expect(mockClipboardManager.cleanup).toHaveBeenCalled();
    });

    it('should return error when workspace folders array is empty', async () => {
      const config = createMockConfig();
      (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [];

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('folder');
    });

    it('should fallback to standard paste when no image in clipboard', async () => {
      const config = createMockConfig();
      (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
        { uri: { fsPath: '/workspace' } },
      ];
      mockClipboardManager.getImageData.mockResolvedValue(createMockClipboardData(false));
      mockClipboardManager.cleanup.mockResolvedValue(undefined);
      vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No image in clipboard, falling back to standard paste'
      );
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'editor.action.clipboardPasteAction'
      );
    });

    it('should process and save image successfully', async () => {
      const config = createMockConfig();
      const processedImage = createMockProcessedImage();

      (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
        { uri: { fsPath: '/workspace' } },
      ];
      mockClipboardManager.getImageData.mockResolvedValue(createMockClipboardData(true));
      mockClipboardManager.cleanup.mockResolvedValue(undefined);
      mockImageProcessor.processAndSave.mockResolvedValue(processedImage);

      // No active editor
      (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
      vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(true);
      expect(result.processedImage).toEqual(processedImage);
      expect(mockImageProcessor.processAndSave).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Image saved', expect.any(Object));
    });

    it('should insert text in active editor when available', async () => {
      const config = createMockConfig();
      const processedImage = createMockProcessedImage();

      (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
        { uri: { fsPath: '/workspace' } },
      ];
      mockClipboardManager.getImageData.mockResolvedValue(createMockClipboardData(true));
      mockClipboardManager.cleanup.mockResolvedValue(undefined);
      mockImageProcessor.processAndSave.mockResolvedValue(processedImage);

      // Setup active editor mock
      const mockEditBuilder = {
        insert: vi.fn(),
        replace: vi.fn(),
      };
      const mockEditor = {
        document: { languageId: 'markdown' },
        selections: [{ isEmpty: true, active: { line: 0, character: 0 } }],
        edit: vi.fn((callback: (builder: typeof mockEditBuilder) => void) => {
          callback(mockEditBuilder);
          return Promise.resolve(true);
        }),
      };
      (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = mockEditor;

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(true);
      expect(result.insertedText).toContain('image_001.png');
      expect(mockEditor.edit).toHaveBeenCalled();
      expect(mockEditBuilder.insert).toHaveBeenCalled();
    });

    it('should replace selection when not empty', async () => {
      const config = createMockConfig();
      const processedImage = createMockProcessedImage();

      (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
        { uri: { fsPath: '/workspace' } },
      ];
      mockClipboardManager.getImageData.mockResolvedValue(createMockClipboardData(true));
      mockClipboardManager.cleanup.mockResolvedValue(undefined);
      mockImageProcessor.processAndSave.mockResolvedValue(processedImage);

      // Setup active editor with non-empty selection
      const mockEditBuilder = {
        insert: vi.fn(),
        replace: vi.fn(),
      };
      const mockEditor = {
        document: { languageId: 'typescript' },
        selections: [{ isEmpty: false, start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }],
        edit: vi.fn((callback: (builder: typeof mockEditBuilder) => void) => {
          callback(mockEditBuilder);
          return Promise.resolve(true);
        }),
      };
      (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = mockEditor;

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(true);
      expect(mockEditBuilder.replace).toHaveBeenCalled();
    });

    it('should copy to clipboard when editor insert fails', async () => {
      const config = createMockConfig();
      const processedImage = createMockProcessedImage();

      (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
        { uri: { fsPath: '/workspace' } },
      ];
      mockClipboardManager.getImageData.mockResolvedValue(createMockClipboardData(true));
      mockClipboardManager.cleanup.mockResolvedValue(undefined);
      mockImageProcessor.processAndSave.mockResolvedValue(processedImage);

      // Setup active editor that fails to edit
      const mockEditor = {
        document: { languageId: 'markdown' },
        selections: [{ isEmpty: true, active: { line: 0, character: 0 } }],
        edit: vi.fn().mockRejectedValue(new Error('Edit failed')),
      };
      (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = mockEditor;
      vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(true);
      expect(result.destination).toBe('clipboard');
      expect(vscode.env.clipboard.writeText).toHaveBeenCalled();
    });

    it('should cleanup on image processing error', async () => {
      const config = createMockConfig();

      (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
        { uri: { fsPath: '/workspace' } },
      ];
      mockClipboardManager.getImageData.mockResolvedValue(createMockClipboardData(true));
      mockClipboardManager.cleanup.mockResolvedValue(undefined);
      mockImageProcessor.processAndSave.mockRejectedValue(new Error('Processing failed'));

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Processing failed');
      expect(mockClipboardManager.cleanup).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    // Replaces two tests that asserted the old fallback chain. It tried
    // `editor.action.clipboardPasteAction` first and treated "did not throw" as
    // "pasted" — but that command resolves whether or not anything handled it,
    // so the second command was unreachable and `copiedToClipboard` was never
    // true. On desktop the first command also reached `webContents.paste()`,
    // firing a native paste at whatever had focus.
    it('copies to the clipboard, and pastes nothing, when there is no editor', async () => {
      const config = createMockConfig();
      const processedImage = createMockProcessedImage();
      arrangeSavedImage(mockClipboardManager, mockImageProcessor, processedImage);

      (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;

      const result = await handler.handlePaste(config, mockLogger);

      expect(result.success).toBe(true);
      expect(result.destination).toBe('clipboard');
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('./.clipshot/image_001.png');
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });
  });

  // Issue #69. VS Code has no runtime API for terminal focus, so the surface
  // arrives as an argument from the keybinding's `when` clause. Everything
  // here turns on the handler believing it rather than asking
  // `activeTextEditor`, which stays set — and stays writable — behind a
  // focused, even maximized, terminal.
  describe('handlePaste on the terminal surface', () => {
    it('types the path into the terminal and leaves the background editor alone', async () => {
      const config = createMockConfig();
      const processedImage = createMockProcessedImage();
      arrangeSavedImage(mockClipboardManager, mockImageProcessor, processedImage);

      const backgroundEditor = createMockEditor('plaintext');
      (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = backgroundEditor;
      const terminal = createMockTerminal();
      (vscode.window as { activeTerminal?: unknown }).activeTerminal = terminal;

      const result = await handler.handlePaste(config, mockLogger, 'terminal');

      expect(result.success).toBe(true);
      expect(result.destination).toBe('terminal');
      // `false` is `shouldExecute`: no newline, so nothing runs.
      expect(terminal.sendText).toHaveBeenCalledWith('./.clipshot/image_001.png', false);
      expect(backgroundEditor.edit).not.toHaveBeenCalled();
      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('sends a bare path even when a Markdown editor is active behind it', async () => {
      const config = createMockConfig();
      const processedImage = createMockProcessedImage();
      arrangeSavedImage(mockClipboardManager, mockImageProcessor, processedImage);

      // `insert.format: auto` used to be resolved from this editor's language,
      // so a Markdown file behind the terminal produced `![alt](path)`.
      (vscode.window as { activeTextEditor?: unknown }).activeTextEditor =
        createMockEditor('markdown');
      const terminal = createMockTerminal();
      (vscode.window as { activeTerminal?: unknown }).activeTerminal = terminal;

      const result = await handler.handlePaste(config, mockLogger, 'terminal');

      expect(result.insertedText).toBe('./.clipshot/image_001.png');
      expect(terminal.sendText).toHaveBeenCalledWith('./.clipshot/image_001.png', false);
    });

    it('still honours a format the user asked for explicitly', async () => {
      const config = createMockConfig({
        insert: { format: 'markdown', altSource: 'filename', altLiteral: 'image' },
      });
      const processedImage = createMockProcessedImage();
      arrangeSavedImage(mockClipboardManager, mockImageProcessor, processedImage);

      const terminal = createMockTerminal();
      (vscode.window as { activeTerminal?: unknown }).activeTerminal = terminal;

      const result = await handler.handlePaste(config, mockLogger, 'terminal');

      expect(result.insertedText).toBe('![image_001.png](./.clipshot/image_001.png)');
    });

    it('copies to the clipboard when terminal.target is clipboard', async () => {
      const config = createMockConfig({ terminal: { registerShortcut: true, target: 'clipboard' } });
      const processedImage = createMockProcessedImage();
      arrangeSavedImage(mockClipboardManager, mockImageProcessor, processedImage);

      const terminal = createMockTerminal();
      (vscode.window as { activeTerminal?: unknown }).activeTerminal = terminal;

      const result = await handler.handlePaste(config, mockLogger, 'terminal');

      expect(result.destination).toBe('clipboard');
      expect(terminal.sendText).not.toHaveBeenCalled();
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('./.clipshot/image_001.png');
    });

    it('falls back to the clipboard rather than an editor when no terminal is active', async () => {
      const config = createMockConfig();
      const processedImage = createMockProcessedImage();
      arrangeSavedImage(mockClipboardManager, mockImageProcessor, processedImage);

      const backgroundEditor = createMockEditor('plaintext');
      (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = backgroundEditor;
      (vscode.window as { activeTerminal?: unknown }).activeTerminal = undefined;

      const result = await handler.handlePaste(config, mockLogger, 'terminal');

      expect(result.destination).toBe('clipboard');
      expect(backgroundEditor.edit).not.toHaveBeenCalled();
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('./.clipshot/image_001.png');
    });

    it('quotes a path containing a space', async () => {
      const config = createMockConfig();
      arrangeSavedImage(mockClipboardManager, mockImageProcessor, {
        ...createMockProcessedImage(),
        relativePath: './my shots/image_001.png',
      });

      const terminal = createMockTerminal();
      (vscode.window as { activeTerminal?: unknown }).activeTerminal = terminal;

      await handler.handlePaste(config, mockLogger, 'terminal');

      expect(terminal.sendText).toHaveBeenCalledWith('"./my shots/image_001.png"', false);
      // The result keeps the path itself; quoting belongs to the terminal.
    });

    it('sends a path that cannot be quoted safely bare', async () => {
      const config = createMockConfig();
      arrangeSavedImage(mockClipboardManager, mockImageProcessor, {
        ...createMockProcessedImage(),
        relativePath: './my "shots"/image_001.png',
      });

      const terminal = createMockTerminal();
      (vscode.window as { activeTerminal?: unknown }).activeTerminal = terminal;

      await handler.handlePaste(config, mockLogger, 'terminal');

      // The escape character differs between POSIX shells and PowerShell, so
      // ClipShot does not guess one.
      expect(terminal.sendText).toHaveBeenCalledWith('./my "shots"/image_001.png', false);
    });

    it('never sends a newline, which would submit the line', async () => {
      const config = createMockConfig();
      arrangeSavedImage(mockClipboardManager, mockImageProcessor, {
        ...createMockProcessedImage(),
        // `saveDirectory` does not pass through `sanitizeFileName`, which is
        // what strips control characters everywhere else.
        relativePath: './shots\r\nrm -rf x/image_001.png',
      });

      const terminal = createMockTerminal();
      (vscode.window as { activeTerminal?: unknown }).activeTerminal = terminal;

      await handler.handlePaste(config, mockLogger, 'terminal');

      const [sent] = vi.mocked(terminal.sendText).mock.calls[0] as [string, boolean];
      expect(sent).not.toMatch(/[\r\n]/);
      expect(sent).toBe('"./shots rm -rf x/image_001.png"');
    });
  });

  describe('isCurrentlyProcessing', () => {
    it('should return false initially', () => {
      expect(handler.isCurrentlyProcessing()).toBe(false);
    });
  });

  describe('getPasteHandler', () => {
    it('should return singleton instance', () => {
      const handler1 = getPasteHandler();
      const handler2 = getPasteHandler();
      expect(handler1).toBe(handler2);
    });
  });
});

describe('Insert Format Auto Detection', () => {
  // Helper to simulate resolveAutoFormat logic
  function resolveAutoFormat(languageId?: string): 'path' | 'markdown' | 'html' {
    switch (languageId) {
      case 'markdown':
        return 'markdown';
      case 'html':
        return 'html';
      default:
        return 'path';
    }
  }

  describe('resolveAutoFormat', () => {
    it('returns markdown for markdown language', () => {
      expect(resolveAutoFormat('markdown')).toBe('markdown');
    });

    it('returns html for html language', () => {
      expect(resolveAutoFormat('html')).toBe('html');
    });

    it('returns path for typescript language', () => {
      expect(resolveAutoFormat('typescript')).toBe('path');
    });

    it('returns path for javascript language', () => {
      expect(resolveAutoFormat('javascript')).toBe('path');
    });

    it('returns path for python language', () => {
      expect(resolveAutoFormat('python')).toBe('path');
    });

    it('returns path for undefined language', () => {
      expect(resolveAutoFormat(undefined)).toBe('path');
    });

    it('returns path for empty string', () => {
      expect(resolveAutoFormat('')).toBe('path');
    });
  });

  describe('formatInsertText logic', () => {
    const mockProcessedImage = {
      relativePath: '.clipshot/image_001.png',
      fileName: 'image_001.png',
    };

    // Helper to simulate formatInsertText logic
    function formatInsertText(
      relativePath: string,
      fileName: string,
      format: 'auto' | 'path' | 'markdown' | 'html',
      altSource: 'filename' | 'literal',
      altLiteral: string,
      languageId?: string
    ): string {
      const path = relativePath;
      const alt = altSource === 'filename' ? fileName : altLiteral;

      const resolvedFormat = format === 'auto'
        ? resolveAutoFormat(languageId)
        : format;

      switch (resolvedFormat) {
        case 'markdown':
          return `![${alt}](${path})`;
        case 'html':
          return `<img src="${path}" alt="${alt}" />`;
        case 'path':
        default:
          return path;
      }
    }

    it('returns path only when format is path', () => {
      const result = formatInsertText(
        mockProcessedImage.relativePath,
        mockProcessedImage.fileName,
        'path',
        'filename',
        'image',
        'markdown'
      );
      expect(result).toBe('.clipshot/image_001.png');
    });

    it('returns markdown format when format is markdown', () => {
      const result = formatInsertText(
        mockProcessedImage.relativePath,
        mockProcessedImage.fileName,
        'markdown',
        'filename',
        'image',
        'typescript'
      );
      expect(result).toBe('![image_001.png](.clipshot/image_001.png)');
    });

    it('returns html format when format is html', () => {
      const result = formatInsertText(
        mockProcessedImage.relativePath,
        mockProcessedImage.fileName,
        'html',
        'filename',
        'image',
        'typescript'
      );
      expect(result).toBe('<img src=".clipshot/image_001.png" alt="image_001.png" />');
    });

    it('auto-detects markdown format for markdown files', () => {
      const result = formatInsertText(
        mockProcessedImage.relativePath,
        mockProcessedImage.fileName,
        'auto',
        'filename',
        'image',
        'markdown'
      );
      expect(result).toBe('![image_001.png](.clipshot/image_001.png)');
    });

    it('auto-detects html format for html files', () => {
      const result = formatInsertText(
        mockProcessedImage.relativePath,
        mockProcessedImage.fileName,
        'auto',
        'filename',
        'image',
        'html'
      );
      expect(result).toBe('<img src=".clipshot/image_001.png" alt="image_001.png" />');
    });

    it('auto-detects path format for typescript files', () => {
      const result = formatInsertText(
        mockProcessedImage.relativePath,
        mockProcessedImage.fileName,
        'auto',
        'filename',
        'image',
        'typescript'
      );
      expect(result).toBe('.clipshot/image_001.png');
    });

    it('uses literal alt text when altSource is literal', () => {
      const result = formatInsertText(
        mockProcessedImage.relativePath,
        mockProcessedImage.fileName,
        'markdown',
        'literal',
        'my custom alt',
        'markdown'
      );
      expect(result).toBe('![my custom alt](.clipshot/image_001.png)');
    });
  });
});
