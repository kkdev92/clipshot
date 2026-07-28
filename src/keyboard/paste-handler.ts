/**
 * Paste handler - orchestrates the image paste workflow
 */

import * as vscode from 'vscode';
import type { ExtensionConfig, PasteResult, InsertFormat, AltSource, ProcessedImage, Logger } from '../core/types';
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
 * Paste handler class
 */
export class PasteHandler {
  private isProcessing = false;

  /**
   * Handle paste command
   *
   * @param config - Extension configuration
   * @param logger - Logger instance
   * @returns Paste result with success status and processed image info
   */
  async handlePaste(
    config: ExtensionConfig,
    logger: Logger
  ): Promise<PasteResult> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      logger.debug('Paste already in progress, skipping');
      return { success: false, error: 'Paste already in progress' };
    }

    this.isProcessing = true;

    try {
      return await this.executePaste(config, logger);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executePaste(
    config: ExtensionConfig,
    logger: Logger
  ): Promise<PasteResult> {
    const editor = vscode.window.activeTextEditor;
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
          logger.error('Sharp load error', toErrorFields(loadError));
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

      // Format the insert text
      const insertText = formatInsertText(
        processedImage,
        config.insert.format,
        config.insert.altSource,
        config.insert.altLiteral,
        editor?.document.languageId
      );

      // Insert text at cursor or copy to clipboard
      const inserted = await this.insertText(insertText, editor);
      let copiedToClipboard = false;

      if (!inserted) {
        // No active text editor - try clipboard-based paste
        // 1. Copy path to clipboard
        await vscode.env.clipboard.writeText(insertText);
        logger.debug('Path copied to clipboard');

        // 2. Try multiple paste commands in order of reliability
        const pasteCommands = [
          'editor.action.clipboardPasteAction',   // Editor, webview
          'workbench.action.terminal.paste',       // Terminal
        ];

        let pasted = false;
        for (const command of pasteCommands) {
          try {
            await vscode.commands.executeCommand(command);
            logger.debug(`Paste attempted via ${command}`);
            pasted = true;
            break;
          } catch {
            logger.debug(`${command} failed, trying next`);
          }
        }

        copiedToClipboard = !pasted;
        if (!pasted) {
          logger.debug('All paste commands failed, path remains in clipboard for manual Ctrl+V');
        }
      }

      // Clean up clipboard manager
      await clipboardManager.cleanup();

      return {
        success: true,
        processedImage,
        insertedText: insertText,
        copiedToClipboard,
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
      logger.error('Paste failed', toErrorFields(error));

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
