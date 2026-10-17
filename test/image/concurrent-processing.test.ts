/**
 * Saves made while Sharp is still loading
 *
 * The first save imports Sharp. A save made before that import finishes has
 * to wait for the same import rather than conclude that Sharp is unavailable.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import sharp from 'sharp';

describe('Saving while Sharp is loading', () => {
  it('converts every image, not only the one that started the import', async () => {
    // A fresh module, so that Sharp has not been loaded yet
    vi.resetModules();
    const { ImageProcessor } = await import('../../src/image/image-processor');
    const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'clipshot-concurrent-'));
    try {
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } })
        .png()
        .toBuffer();

      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          new ImageProcessor(root).processAndSave(png, '.clipshot', 'image_${seq3}', {
            format: 'jpeg',
            jpegQuality: 80,
            webpQuality: 80,
            maxFileSizeMB: 10,
            resizeMode: 'fit',
            maxWidth: 2,
            maxHeight: 2,
          })
        )
      );

      expect(new Set(results.map((result) => result.absolutePath)).size).toBe(4);
      for (const result of results) {
        const metadata = await sharp(await fs.readFile(result.absolutePath)).metadata();
        expect(metadata.format).toBe('jpeg');
        expect([metadata.width, metadata.height]).toEqual([2, 2]);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
