/**
 * Saving when Sharp cannot load
 *
 * Nothing can be converted or resized then, so the image is saved as the
 * clipboard gave it — and named for the format it is actually in.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createMockLogger } from '@kkdev92/vscode-ext-kit/testing';
import { ImageProcessor, type ImageProcessorOptions } from '../../src/image/image-processor';
import { clearSequenceCache } from '../../src/image/path-generator';
import type { ImageFormat } from '../../src/core/types';

vi.mock('sharp', () => {
  throw new Error('native module unavailable');
});

/** An image in the given format, made with the real Sharp the test has. */
async function imageIn(format: 'png' | 'jpeg'): Promise<Buffer> {
  const { default: sharp } = await vi.importActual<typeof import('sharp')>('sharp');
  return sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } })
    .toFormat(format)
    .toBuffer();
}

function optionsFor(format: ImageFormat): ImageProcessorOptions {
  return {
    format,
    jpegQuality: 80,
    webpQuality: 80,
    maxFileSizeMB: 10,
    resizeMode: 'off',
    maxWidth: null,
    maxHeight: null,
  };
}

describe('Saving without Sharp', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'clipshot-fallback-'));
    clearSequenceCache();
  });

  afterEach(async () => {
    clearSequenceCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('cannot load Sharp in this test file', async () => {
    expect(await new ImageProcessor(root).isSharpAvailable()).toBe(false);
  });

  it.each([
    // [clipboard image, requested format, saved as]
    ['png', 'png', 'png'],
    ['jpeg', 'jpeg', 'jpeg'],
    ['png', 'jpeg', 'png'],
    ['png', 'webp', 'png'],
    ['jpeg', 'png', 'jpeg'],
  ] as const)('saves a %s image, with %s asked for, as %s', async (input, requested, saved) => {
    const image = await imageIn(input);
    const logger = createMockLogger(vi);

    const result = await new ImageProcessor(root, logger).processAndSave(
      image,
      '.clipshot',
      'image_${seq3}',
      optionsFor(requested)
    );

    expect(result.format).toBe(saved);
    expect(result.fileName).toBe(`image_001.${saved}`);
    expect(await fs.readFile(result.absolutePath)).toEqual(image);
    if (saved !== requested) {
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('needs Sharp'));
    }
  });

  it('refuses an image it could only save after converting it, and writes nothing', async () => {
    // A bitmap header: an image the clipboard tools do not produce, but one
    // the processor accepts as input
    const bitmap = Buffer.concat([Buffer.from('BM'), Buffer.alloc(62)]);

    await expect(
      new ImageProcessor(root).processAndSave(bitmap, '.clipshot', 'image_${seq3}', optionsFor('png'))
    ).rejects.toThrow('neither PNG nor JPEG');

    expect(await fs.readdir(root)).toEqual([]);
  });
});
