/**
 * Saving an image under a name that is already taken
 *
 * Real files and a real sharp. The clock is fixed, so each case decides whether
 * two saves fall in the same second — which is what makes the sequence number
 * start again at 1.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { build } from 'esbuild';
import sharp from 'sharp';
import { ImageProcessor, type ImageProcessorOptions } from '../../src/image/image-processor';
import { clearSequenceCache } from '../../src/image/path-generator';
import { DEFAULTS } from '../../src/core/constants';

const options: ImageProcessorOptions = {
  format: 'png',
  jpegQuality: 80,
  webpQuality: 80,
  maxFileSizeMB: 10,
  resizeMode: 'off',
  maxWidth: null,
  maxHeight: null,
};

/** A one-pixel PNG of the given colour. */
function pixel(background: string): Promise<Buffer> {
  return sharp({ create: { width: 1, height: 1, channels: 3, background } }).png().toBuffer();
}

describe('Saving an image whose name is taken', () => {
  let root: string;
  let red: Buffer;
  let blue: Buffer;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'clipshot-collisions-'));
    red = await pixel('#ff0000');
    blue = await pixel('#0000ff');
    clearSequenceCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 17, 12, 0, 0, 100));
  });

  afterEach(async () => {
    vi.useRealTimers();
    clearSequenceCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([
    // Without the seconds in the pattern, the number starts again at 1 a second later
    ['image_${seq3}', 1000, 'image_002.png'],
    ['${yyyy}${MM}${dd}_${seq3}', 1000, '20261017_002.png'],
    ['screenshot', 1000, 'screenshot_1.png'],
    // The default pattern does not repeat: a new second, or the next number in the same one
    [DEFAULTS.FILE_NAME_PATTERN, 1000, 'image_20261017_120001_001.png'],
    [DEFAULTS.FILE_NAME_PATTERN, 100, 'image_20261017_120000_002.png'],
    // A pattern so long the number is cut off gets a suffix instead
    ['a'.repeat(200) + '_${seq3}', 1000, 'a'.repeat(198) + '_1.png'],
    ['画像'.repeat(100) + '_${seq3}', 1000, '画像'.repeat(33) + '_1.png'],
  ])('keeps the first image for %s, and saves one %i ms later as %s', async (pattern, later, second) => {
    const processor = new ImageProcessor(root);
    const first = await processor.processAndSave(red, '.clipshot', pattern, options);
    vi.setSystemTime(new Date(Date.now() + later));

    const result = await processor.processAndSave(blue, '.clipshot', pattern, options);

    expect(result.fileName).toBe(second);
    expect(result.relativePath).toBe(`./.clipshot/${second}`);
    expect(await fs.readFile(first.absolutePath)).toEqual(red);
    expect(await fs.readFile(result.absolutePath)).toEqual(blue);
    expect(await fs.readdir(path.join(root, '.clipshot'))).toHaveLength(2);
  });

  it('keeps the image saved before the sequence counter started again', async () => {
    // A reloaded window starts its counter at 1 within the same second
    const first = await new ImageProcessor(root).processAndSave(red, '.clipshot', DEFAULTS.FILE_NAME_PATTERN, options);
    clearSequenceCache();

    const result = await new ImageProcessor(root).processAndSave(blue, '.clipshot', DEFAULTS.FILE_NAME_PATTERN, options);

    expect(result.fileName).toBe('image_20261017_120000_002.png');
    expect(await fs.readFile(first.absolutePath)).toEqual(red);
  });

  it('keeps every image when separate processes save the same name at once', async () => {
    // Each VS Code window has an extension host of its own, and so a sequence
    // counter of its own
    const worker = path.join(root, 'worker.cjs');
    await build({
      stdin: {
        contents: `
          import { FileWriter } from './src/image/file-writer';
          const [root, target, data] = process.argv.slice(2);
          new FileWriter(root)
            .writeAtomic(target, Buffer.from(data, 'base64'))
            .then((result) => console.log(JSON.stringify(result)))
            .catch((error) => { console.error(error); process.exitCode = 1; });
        `,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      outfile: worker,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    });
    const target = path.join(root, 'images', 'image_20261017_120000_001.png');
    const images = [red, blue, Buffer.alloc(2048, 123)];

    const results = await Promise.all(
      images.map(async (image) => {
        const { stdout } = await promisify(execFile)(process.execPath, [
          worker,
          root,
          target,
          image.toString('base64'),
        ]);
        return JSON.parse(stdout) as { absolutePath: string };
      })
    );

    expect(new Set(results.map((result) => result.absolutePath)).size).toBe(images.length);
    for (const [i, result] of results.entries()) {
      expect(await fs.readFile(result.absolutePath)).toEqual(images[i]);
    }
    expect(await fs.readdir(path.join(root, 'images'))).toHaveLength(images.length);
  });
});
