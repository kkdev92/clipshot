/**
 * Paste handler - orchestrates the image paste workflow
 */

import * as vscode from 'vscode';
import type {
  ExtensionConfig,
  PasteResult,
  PasteDestination,
  PasteSurface,
  InsertFormat,
  AltSource,
  ProcessedImage,
  Logger,
} from '../core/types';
import {
  NoImageError,
  NoWorkspaceError,
  getUserErrorMessage,
} from '../core/errors';
import { RESIZE_PRESETS } from '../core/constants';
import { getClipboardManager } from '../clipboard/clipboard-manager';
import { ImageProcessor, getSharpLoadError } from '../image/image-processor';

/**
 * Resolve resize options from config, applying preset if set
 *
 * @param config - Extension configuration
 * @returns Resolved maxWidth and maxHeight values
 */
function resolveResizeOptions(config: ExtensionConfig): {
  maxWidth: number | null;
  maxHeight: number | null;
} {
  // Preset overrides manual settings
  if (config.resize.preset) {
    const preset = RESIZE_PRESETS[config.resize.preset];
    return {
      maxWidth: preset.maxWidth,
      maxHeight: preset.maxHeight,
    };
  }

  return {
    maxWidth: config.resize.maxWidth,
    maxHeight: config.resize.maxHeight,
  };
}

/**
 * Resolve auto format based on language ID
 */
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

/**
 * Format the insert text based on configuration
 */
function formatInsertText(
  processedImage: ProcessedImage,
  format: InsertFormat,
  altSource: AltSource,
  altLiteral: string,
  languageId?: string
): string {
  const path = processedImage.relativePath;
  const alt = altSource === 'filename' ? processedImage.fileName : altLiteral;

  // Resolve auto format based on file type
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

/**
 * A saved path as one line a terminal can take.
 */
function toTerminalLine(text: string): string {
  // A newline would submit the line rather than type it. `sendText` appends
  // none, but one already inside the text would do the job itself — and
  // `saveDirectory` reaches the path without passing through
  // `sanitizeFileName`, which is what strips control characters everywhere
  // else.
  const line = text.replace(/[\r\n]+/g, ' ').trim();

  // A shell splits on spaces, so a path holding one has to arrive quoted.
  // Quotes inside are not escaped, and deliberately: `sanitizeFileName`
  // removes `"` from the file name, the only other way one reaches the path is
  // a `saveDirectory` the validator already warns about, and the escape
  // character differs between POSIX shells and PowerShell — inventing one
  // would break whichever shell it guessed wrong about. A path that cannot be
  // quoted is sent bare.
  return /\s/.test(line) && !line.includes('"') ? `"${line}"` : line;
}

/**
 * Paste handler class
 */
export class PasteHandler {
  private isProcessing = false;

  /**
   * Handle paste command
   *
   * @param config - Extension configuration
   * @param logger - Logger instance
   * @param surface - Which pane the shortcut was pressed in. Supplied by the
   *   keybinding's `when` clause, because VS Code exposes no runtime API for
   *   focus; defaults to the editor for the Command Palette and for callers
   *   that pass nothing.
   * @returns Paste result with success status and processed image info
   */
  async handlePaste(
    config: ExtensionConfig,
    logger: Logger,
    surface: PasteSurface = 'editor'
  ): Promise<PasteResult> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      logger.debug('Paste already in progress, skipping');
      return { success: false, error: 'Paste already in progress' };
    }

    this.isProcessing = true;

    try {
      return await this.executePaste(config, logger, surface);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executePaste(
    config: ExtensionConfig,
    logger: Logger,
    surface: PasteSurface
  ): Promise<PasteResult> {
    // Read only on the editor surface. `activeTextEditor` is "the editor with
    // focus, or the last one to change input", so with a terminal focused it
    // still names a background editor — one that may not even be visible.
    // Touching it at all is the bug this branch exists to avoid.
    const editor = surface === 'terminal' ? undefined : vscode.window.activeTextEditor;
    const clipboardManager = getClipboardManager(logger);

    try {
      // Check if extension is enabled
      if (!config.enabled) {
        logger.debug('Extension is disabled');
        return await this.fallbackToStandardPaste('Extension disabled');
      }

      // Get workspace root
      const workspaceRoot = this.getWorkspaceRoot();
      if (workspaceRoot === undefined || workspaceRoot === '') {
        throw new NoWorkspaceError();
      }

      // Kick off the Sharp dynamic import now so the native module loads
      // while the clipboard subprocess runs (isSharpAvailable never rejects)
      const imageProcessor = new ImageProcessor(workspaceRoot, logger);
      const sharpAvailablePromise = imageProcessor.isSharpAvailable();

      // Get image data from clipboard (includes hasImage check)
      logger.debug('Reading clipboard image');
      const clipboardStart = Date.now();
      const clipboardData = await clipboardManager.getImageData();
      logger.debug('Clipboard read finished', {
        durationMs: Date.now() - clipboardStart,
        size: clipboardData.imageBuffer?.length ?? 0,
      });

      if (!clipboardData.hasImage || !clipboardData.imageBuffer) {
        throw new NoImageError();
      }

      // Process and save the image
      logger.debug('Processing image', { size: clipboardData.imageBuffer.length });

      // Check Sharp availability (already loading since before the clipboard read)
      const sharpAvailable = await sharpAvailablePromise;
      if (!sharpAvailable) {
        const loadError = getSharpLoadError();
        logger.warn('Sharp is not available - resize will be skipped');
        if (loadError !== null && loadError !== undefined) {
          logger.error('Sharp failed to load', loadError, { context: 'sharp-load' });
        }
      }

      // Resolve resize options (preset overrides manual settings)
      const resizeOptions = resolveResizeOptions(config);
      logger.debug('Resize config', {
        mode: config.resize.mode,
        preset: config.resize.preset,
        maxWidth: resizeOptions.maxWidth,
        maxHeight: resizeOptions.maxHeight,
        sharpAvailable,
      });

      const processStart = Date.now();
      const processedImage = await imageProcessor.processAndSave(
        clipboardData.imageBuffer,
        config.saveDirectory,
        config.fileName.pattern,
        {
          format: config.output.format,
          jpegQuality: config.output.jpegQuality,
          webpQuality: config.output.webpQuality,
          maxFileSizeMB: config.limits.maxFileSizeMB,
          resizeMode: config.resize.mode,
          maxWidth: resizeOptions.maxWidth,
          maxHeight: resizeOptions.maxHeight,
        }
      );

      logger.info('Image saved', {
        path: processedImage.relativePath,
        processingMs: Date.now() - processStart,
      });

      // Format the insert text. On the terminal surface there is no language
      // to read, so `auto` resolves to the bare path a shell can use — and a
      // Markdown file sitting behind the terminal no longer decides the format.
      const insertText = formatInsertText(
        processedImage,
        config.insert.format,
        config.insert.altSource,
        config.insert.altLiteral,
        editor?.document.languageId
      );

      const destination = await this.deliver(insertText, surface, config, editor, logger);

      // Clean up clipboard manager
      await clipboardManager.cleanup();

      return {
        success: true,
        processedImage,
        insertedText: insertText,
        destination,
      };
    } catch (error) {
      // Clean up on error
      await clipboardManager.cleanup();

      // Handle known errors
      if (error instanceof NoImageError) {
        logger.debug('No image in clipboard, falling back to standard paste');
        return await this.fallbackToStandardPaste('No image in clipboard');
      }

      // Log and return error
      const message = getUserErrorMessage(error);
      // The message is what the user will be shown; the error itself carries
      // the stack, which the framework's logger takes as its own argument.
      logger.error(message, error, { context: 'paste' });

      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get the workspace root path
   */
  private getWorkspaceRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    return workspaceFolders[0]?.uri.fsPath;
  }

  /**
   * Puts the path where the shortcut was pressed, and says where that was.
   *
   * The clipboard is the last resort rather than a fourth case: it is what
   * happens when the surface has nowhere to put the text, and what the user
   * asked for when `clipshot.terminal.target` is `clipboard`.
   */
  private async deliver(
    text: string,
    surface: PasteSurface,
    config: ExtensionConfig,
    editor: vscode.TextEditor | undefined,
    logger: Logger
  ): Promise<PasteDestination> {
    if (surface === 'terminal') {
      if (config.terminal.target === 'terminal' && this.sendToTerminal(text, logger)) {
        return 'terminal';
      }
    } else if (await this.insertText(text, editor)) {
      return 'editor';
    }

    // Nothing is pasted on the user's behalf here. The version that tried to
    // could not tell success from failure —
    // `editor.action.clipboardPasteAction` resolves whether or not anything
    // handled it — and on desktop it reached `webContents.paste()`, firing a
    // native paste at whatever had focus, after overwriting the image the user
    // had just copied. Leaving the path on the clipboard and saying so is the
    // behaviour the README always described.
    await vscode.env.clipboard.writeText(text);
    logger.debug('Path copied to clipboard');
    return 'clipboard';
  }

  /**
   * Types the path into the focused terminal.
   *
   * @returns false when there is no terminal to type into, so the caller can
   *   fall back rather than dropping the path
   */
  private sendToTerminal(text: string, logger: Logger): boolean {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      logger.debug('Terminal has focus but no terminal is active; using the clipboard');
      return false;
    }

    // `false` is `shouldExecute`: no newline is appended, so the path is typed
    // and nothing runs until the user says so.
    terminal.sendText(toTerminalLine(text), false);
    logger.debug('Path sent to the terminal');
    return true;
  }

  /**
   * Insert text at cursor position(s)
   */
  private async insertText(
    text: string,
    editor?: vscode.TextEditor
  ): Promise<boolean> {
    if (!editor) {
      return false;
    }

    try {
      const success = await editor.edit((editBuilder) => {
        // Insert at all cursor positions
        for (const selection of editor.selections) {
          if (selection.isEmpty) {
            editBuilder.insert(selection.active, text);
          } else {
            editBuilder.replace(selection, text);
          }
        }
      });

      return success;
    } catch {
      return false;
    }
  }

  /**
   * Fall back to standard paste behavior
   */
  private async fallbackToStandardPaste(reason: string): Promise<PasteResult> {
    try {
      // Execute the standard paste command
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
      return { success: true };
    } catch {
      return { success: false, error: reason };
    }
  }

  /**
   * Check if currently processing
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }
}

// Singleton instance
let globalPasteHandler: PasteHandler | null = null;

/**
 * Get the global paste handler instance
 */
export function getPasteHandler(): PasteHandler {
  if (!globalPasteHandler) {
    globalPasteHandler = new PasteHandler();
  }
  return globalPasteHandler;
}
