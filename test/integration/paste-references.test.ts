/**
 * Integration tests for the reference a paste inserts
 *
 * The whole paste runs — a real sharp, real files — with only VS Code and the
 * clipboard mocked. What is checked is what a reader of the document sees: the
 * inserted Markdown or HTML is parsed, and the image's `src`, resolved against
 * the document, has to be the file that was saved.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import sharp from 'sharp';
import { marked } from 'marked';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import * as vscode from 'vscode';
import { createMockLogger } from '@kkdev92/vscode-ext-kit/testing';
import type { ExtensionConfig } from '../../src/core/types';
import { DEFAULTS } from '../../src/core/constants';
import { clearSequenceCache } from '../../src/image/path-generator';
import { PasteHandler } from '../../src/keyboard/paste-handler';
import { getClipboardManager } from '../../src/clipboard/clipboard-manager';

vi.mock('../../src/clipboard/clipboard-manager', () => ({
  getClipboardManager: vi.fn(),
}));

/** The settings as a user who changed nothing has them. */
function defaultConfig(): ExtensionConfig {
  return {
    enabled: true,
    logLevel: 'info',
    saveDirectory: DEFAULTS.SAVE_DIRECTORY,
    fileName: { pattern: DEFAULTS.FILE_NAME_PATTERN, sequenceDigits: DEFAULTS.SEQUENCE_DIGITS },
    output: { format: 'png', jpegQuality: 80, webpQuality: 80 },
    resize: { mode: 'off', maxWidth: null, maxHeight: null, preset: null },
    insert: { format: 'auto', altSource: 'filename', altLiteral: 'image' },
    limits: { maxFileSizeMB: 10 },
    notifications: { level: 'all' },
    terminal: { registerShortcut: true, target: 'terminal' },
  };
}

/** Every `<img>` in an HTML fragment, as its attributes. */
function imagesIn(html: string): Record<string, string>[] {
  const images: Record<string, string>[] = [];
  const visit = (node: DefaultTreeAdapterMap['node']): void => {
    if ('tagName' in node && node.tagName === 'img') {
      images.push(Object.fromEntries(node.attrs.map((attribute) => [attribute.name, attribute.value])));
    }
    if ('childNodes' in node) {
      node.childNodes.forEach(visit);
    }
  };
  visit(parseFragment(html));
  return images;
}

/** The one image a reader of the document would see, from Markdown or HTML. */
async function imageIn(reference: string, language: 'markdown' | 'html'): Promise<Record<string, string>> {
  const html = language === 'markdown' ? await marked.parse(reference) : reference;
  const images = imagesIn(html);
  expect(images).toHaveLength(1);
  return images[0]!;
}

/** The file a `src` reaches from the document it is written in. */
function resolveFrom(documentPath: string, src: string): string {
  return fileURLToPath(new URL(src, pathToFileURL(documentPath)));
}

describe('Paste references', () => {
  let root: string;
  let config: ExtensionConfig;

  /** Make `folders` the workspace, with getWorkspaceFolder answering for them. */
  function openWorkspace(folders: string[]): void {
    const entries = folders.map((folder, index) => ({
      uri: vscode.Uri.file(folder),
      name: path.basename(folder),
      index,
    }));
    (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = entries;
    vi.mocked(vscode.workspace.getWorkspaceFolder).mockImplementation(
      (uri) =>
        entries.find((entry) => {
          const relative = path.relative(entry.uri.fsPath, uri.fsPath);
          return !relative.startsWith('..') && !path.isAbsolute(relative);
        }) as never
    );
  }

  /** Paste into a document at `documentPath`, and return what was inserted. */
  async function pasteInto(documentPath: string, languageId: string): Promise<string> {
    const inserted: string[] = [];
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = {
      document: { languageId, uri: vscode.Uri.file(documentPath), isUntitled: false },
      selections: [{ isEmpty: true, active: { line: 0, character: 0 } }],
      edit: vi.fn((build: (builder: { insert: (at: unknown, text: string) => void }) => void) => {
        build({ insert: (_at, text) => inserted.push(text) });
        return Promise.resolve(true);
      }),
    };

    const result = await new PasteHandler().handlePaste(config, createMockLogger(vi));

    expect(result.success).toBe(true);
    expect(result.destination).toBe('editor');
    expect(inserted).toEqual([result.insertedText]);
    return result.insertedText!;
  }

  /** The one image saved under the workspace folder `folder`. */
  async function savedImage(folder: string, saveDirectory: string = DEFAULTS.SAVE_DIRECTORY): Promise<string> {
    const names = await fs.readdir(path.join(folder, saveDirectory));
    expect(names).toHaveLength(1);
    return path.join(folder, saveDirectory, names[0]!);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    clearSequenceCache();
    root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'clipshot-references-'));
    config = defaultConfig();
    const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer();
    vi.mocked(getClipboardManager).mockReturnValue({
      getImageData: vi.fn().mockResolvedValue({ hasImage: true, hasText: false, imageBuffer: image, format: 'png' }),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as never);
    openWorkspace([root]);
  });

  afterEach(async () => {
    clearSequenceCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([
    ['README.md', 'markdown'],
    ['docs/guide.md', 'markdown'],
    ['docs/deep/er/notes.md', 'markdown'],
    ['index.html', 'html'],
    ['site/pages/index.html', 'html'],
  ] as const)('shows the saved image in %s', async (file, language) => {
    const documentPath = path.join(root, file);

    const reference = await pasteInto(documentPath, language);

    const image = await imageIn(reference, language);
    const saved = await savedImage(root);
    expect(resolveFrom(documentPath, image['src']!)).toBe(saved);
    expect(image['alt']).toBe(path.basename(saved));
  });

  it('resolves through spaces and characters a link cannot carry, and keeps other ones readable', async () => {
    config.saveDirectory = 'my shots';
    config.fileName.pattern = '画像 (1)#100%_${seq3}';
    const documentPath = path.join(root, 'docs', 'guide.md');

    const reference = await pasteInto(documentPath, 'markdown');

    expect(reference).toContain('画像');
    const image = await imageIn(reference, 'markdown');
    expect(resolveFrom(documentPath, image['src']!)).toBe(await savedImage(root, 'my shots'));
  });

  it.each(['markdown', 'html'] as const)('keeps literal alt text intact in %s', async (language) => {
    config.insert.altSource = 'literal';
    config.insert.altLiteral = 'step [2] \\ "quoted" & <done>';
    const documentPath = path.join(root, language === 'markdown' ? 'notes.md' : 'notes.html');

    const image = await imageIn(await pasteInto(documentPath, language), language);

    expect(image['alt']).toBe(config.insert.altLiteral);
    expect(resolveFrom(documentPath, image['src']!)).toBe(await savedImage(root));
  });

  it('saves into the folder that holds the document, in a multi-root workspace', async () => {
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    await fs.mkdir(first);
    await fs.mkdir(second);
    openWorkspace([first, second]);
    const documentPath = path.join(second, 'docs', 'guide.md');

    const image = await imageIn(await pasteInto(documentPath, 'markdown'), 'markdown');

    expect(resolveFrom(documentPath, image['src']!)).toBe(await savedImage(second));
    expect(await fs.readdir(first)).toEqual([]);
  });

  it.skipIf(process.platform !== 'win32')(
    'links a document on another drive to the image with a file URL',
    async () => {
      // Outside every workspace folder, on whichever drive the workspace is not
      const drive = path.parse(root).root.toUpperCase().startsWith('D') ? 'E:\\' : 'D:\\';
      const documentPath = path.join(drive, 'notes', 'guide.md');

      const image = await imageIn(await pasteInto(documentPath, 'markdown'), 'markdown');

      expect(image['src']).toMatch(/^file:\/\/\//);
      expect(resolveFrom(documentPath, image['src']!)).toBe(await savedImage(root));
    }
  );
});
