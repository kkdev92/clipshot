/**
 * Paste handler - orchestrates the image paste workflow
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { pathToFileURL } from 'url';
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
  toErrorFields,
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
 *
 * @param documentPath - The file the text goes into, when it is one; Markdown
 *   and HTML point at the image from there
 */
function formatInsertText(
  processedImage: ProcessedImage,
  format: InsertFormat,
  altSource: AltSource,
  altLiteral: string,
  languageId?: string,
  documentPath?: string
): string {
  const alt = altSource === 'filename' ? processedImage.fileName : altLiteral;

  // Resolve auto format based on file type
  const resolvedFormat = format === 'auto'
    ? resolveAutoFormat(languageId)
    : format;

  switch (resolvedFormat) {
    case 'markdown':
      return `![${escapeMarkdownText(alt)}](${linkTarget(processedImage, documentPath)})`;
    case 'html': {
      const src = linkTarget(processedImage, documentPath);
      return `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" />`;
    }
    case 'path':
    default:
      return processedImage.relativePath;
  }
}

/**
 * Where a Markdown or HTML reference points to reach the saved image
 *
 * Relative to the document, which is what such a link is resolved against: a
 * path from the workspace root breaks in any file below the root. Without a
 * document on disk there is only the workspace-relative path. Between two
 * Windows drives there is no relative path at all, so the link is a file URL.
 */
function linkTarget(image: ProcessedImage, documentPath: string | undefined): string {
  if (documentPath === undefined) {
    return encodeLinkPath(image.relativePath);
  }

  const relative = path.relative(path.dirname(documentPath), image.absolutePath);
  if (path.isAbsolute(relative)) {
    return pathToFileURL(image.absolutePath).href;
  }

  const posix = relative.split(path.sep).join('/');
  return encodeLinkPath(posix.startsWith('../') ? posix : `./${posix}`);
}

/**
 * Percent-encode what a link cannot carry as it is
 *
 * Whitespace and control characters end a Markdown link destination, and so
 * does a parenthesis without its pair; `<` and `>` delimit one, `&` starts a
 * character reference, and `%`, `#` and `?` would be read as an escape, a
 * fragment and a query. Everything else, non-ASCII included, is left readable.
 */
function encodeLinkPath(linkPath: string): string {
  return linkPath.replace(/[\s\p{Cc}%#?()<>&]/gu, (character) => {
    switch (character) {
      case '(':
        return '%28';
      case ')':
        return '%29';
      default:
        return encodeURIComponent(character);
    }
  });
}

/**
 * Escape Markdown link text: the brackets that would end it early, and the
 * backslash that escapes them. Other punctuation cannot break the image, and
 * escaping it would scatter backslashes through every file name.
 */
function escapeMarkdownText(text: string): string {
  return text.replace(/[\\[\]]/g, '\\$&');
}

/**
 * Escape a value for an HTML attribute in double quotes
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The path of the document being pasted into, when it is a file on disk
 *
 * An untitled document has no folder to be relative to, and one that is not a
 * file — a Git revision, the user settings — is not where the reference will
 * be read.
 */
function documentPathOf(editor: vscode.TextEditor | undefined): string | undefined {
  const document = editor?.document;
  if (document === undefined || document.isUntitled) {
    return undefined;
  }
  // A remote workspace's files are paths on the remote machine, like the
  // workspace folder the image is saved under
  const scheme = document.uri.scheme;
  return scheme === 'file' || scheme === 'vscode-remote' ? document.uri.fsPath : undefined;
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
    // The terminal the shortcut was pressed in, taken now, as the editor is:
    // by the time the image is saved the user may have moved to another one.
    const terminal = surface === 'terminal' ? vscode.window.activeTerminal : undefined;
    // Set up inside the try, so that a failure to set it up is reported like
    // any other failed paste
    let clipboardManager: ReturnType<typeof getClipboardManager> | undefined;

    try {
      // Check if extension is enabled
      if (!config.enabled) {
        logger.debug('Extension is disabled');
        return await this.fallbackToStandardPaste('Extension disabled');
      }

      // Get workspace root
      const workspaceRoot = this.getWorkspaceRoot(editor);
      if (workspaceRoot === undefined || workspaceRoot === '') {
        throw new NoWorkspaceError();
      }

      clipboardManager = getClipboardManager(logger);

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
        logger.warn('Sharp is not available - resize and format conversion will be skipped');
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
          sequenceDigits: config.fileName.sequenceDigits,
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
        editor?.document.languageId,
        documentPathOf(editor)
      );

      const destination = await this.deliver(insertText, surface, config, editor, terminal, logger);

      return {
        success: true,
        processedImage,
        insertedText: insertText,
        destination,
      };
    } catch (error) {
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
    } finally {
      // Clean up clipboard manager, on success and on error. A failure here
      // neither undoes a saved image nor replaces the error being reported.
      try {
        await clipboardManager?.cleanup();
      } catch (error) {
        logger.warn('Clipboard cleanup failed', toErrorFields(error));
      }
    }
  }

  /**
   * Get the workspace root path
   *
   * In a multi-root workspace, the folder that holds the document being
   * pasted into: an image saved in the first folder is not where a path
   * relative to another one can reach. A terminal paste, or a document in no
   * folder, takes the first.
   */
  private getWorkspaceRoot(editor: vscode.TextEditor | undefined): string | undefined {
    if (editor !== undefined) {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (folder !== undefined) {
        return folder.uri.fsPath;
      }
    }

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
    terminal: vscode.Terminal | undefined,
    logger: Logger
  ): Promise<PasteDestination> {
    if (surface === 'terminal') {
      if (config.terminal.target === 'terminal' && this.sendToTerminal(text, terminal, logger)) {
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
   * Types the path into the terminal the shortcut was pressed in.
   *
   * @param terminal - The active terminal when the paste started
   * @returns false when there is no terminal to type into, so the caller can
   *   fall back rather than dropping the path
   */
  private sendToTerminal(text: string, terminal: vscode.Terminal | undefined, logger: Logger): boolean {
    if (!terminal) {
      logger.debug('Terminal has focus but no terminal is active; using the clipboard');
      return false;
    }

    // Reading the clipboard and saving take a moment, in which the user can
    // switch terminals or close this one. The path does not follow them into
    // whichever terminal is active by then.
    if (terminal !== vscode.window.activeTerminal || terminal.exitStatus !== undefined) {
      logger.debug('The terminal the paste started in is no longer active; using the clipboard');
      return false;
    }

    // `false` is `shouldExecute`: no newline is appended, so the path is typed
    // and nothing runs until the user says so.
    try {
      terminal.sendText(toTerminalLine(text), false);
    } catch (error) {
      // A terminal disposed of meanwhile throws rather than takes the text,
      // and the image is saved by now
      logger.warn('Could not type into the terminal; using the clipboard', toErrorFields(error));
      return false;
    }
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
