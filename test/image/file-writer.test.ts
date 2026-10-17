import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileWriter } from '../../src/image/file-writer';

// link, copyFile and unlink call the real functions unless a test makes one
// fail the way a file system without hard links, or a locked file, would.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    link: vi.fn(actual.link),
    copyFile: vi.fn(actual.copyFile),
    unlink: vi.fn(actual.unlink),
  };
});

/** An error the way Node reports a failed system call. */
function systemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

describe('FileWriter', () => {
  let testDir: string;
  let writer: FileWriter;

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    vi.mocked(fs.link).mockReset().mockImplementation(actual.link);
    vi.mocked(fs.copyFile).mockReset().mockImplementation(actual.copyFile);
    vi.mocked(fs.unlink).mockReset().mockImplementation(actual.unlink);

    // Create a temporary test directory
    // Use realpath to resolve symlinks (macOS) and short paths (Windows)
    const tmpBase = await fs.realpath(os.tmpdir());
    testDir = await fs.mkdtemp(path.join(tmpBase, 'clipshot-test-'));
    writer = new FileWriter(testDir);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('writeAtomic', () => {
    it('should write data to file', async () => {
      const testData = Buffer.from('test image data');
      const filePath = path.join(testDir, 'test.png');

      const result = await writer.writeAtomic(filePath, testData);

      expect(result.absolutePath).toBe(filePath);
      expect(result.fileSize).toBe(testData.length);

      // Verify file was created
      const readData = await fs.readFile(filePath);
      expect(readData).toEqual(testData);
    });

    it('should create parent directories', async () => {
      const testData = Buffer.from('test');
      const nestedPath = path.join(testDir, 'nested', 'dir', 'test.png');

      await writer.writeAtomic(nestedPath, testData, { createDirs: true });

      const exists = await writer.exists(nestedPath);
      expect(exists).toBe(true);
    });

    it('should set correct file permissions', async () => {
      const testData = Buffer.from('test');
      const filePath = path.join(testDir, 'perms.png');

      await writer.writeAtomic(filePath, testData, { mode: 0o644 });

      const stats = await fs.stat(filePath);
      // On Windows, mode checking is limited
      if (process.platform !== 'win32') {
        expect(stats.mode & 0o777).toBe(0o644);
      }
    });

    it('should throw for paths outside workspace', async () => {
      const testData = Buffer.from('test');
      const outsidePath = path.join(os.tmpdir(), 'outside-workspace.png');

      await expect(writer.writeAtomic(outsidePath, testData)).rejects.toThrow();
    });

    it('should refuse a folder link leading out of the workspace before creating anything', async () => {
      const workspace = path.join(testDir, 'workspace');
      const outside = path.join(testDir, 'outside');
      await fs.mkdir(workspace);
      await fs.mkdir(outside);
      // A junction on Windows needs no privilege; elsewhere the type is ignored
      await fs.symlink(outside, path.join(workspace, 'link-out'), 'junction');

      const target = path.join(workspace, 'link-out', 'new', 'image.png');
      await expect(new FileWriter(workspace).writeAtomic(target, Buffer.from('new'))).rejects.toThrow(
        'outside workspace'
      );

      expect(await fs.readdir(outside)).toEqual([]);
    });

    it('should keep an existing file and save under the next free name', async () => {
      const target = path.join(testDir, 'image.png');
      await fs.writeFile(target, 'first');
      await fs.writeFile(path.join(testDir, 'image_1.png'), 'second');

      const result = await writer.writeAtomic(target, Buffer.from('third'));

      expect(result.absolutePath).toBe(path.join(testDir, 'image_2.png'));
      expect(await fs.readFile(target, 'utf8')).toBe('first');
      expect(await fs.readFile(path.join(testDir, 'image_1.png'), 'utf8')).toBe('second');
      expect(await fs.readFile(result.absolutePath, 'utf8')).toBe('third');
      // ...and leave no temporary file behind
      expect((await fs.readdir(testDir)).sort()).toEqual(['image.png', 'image_1.png', 'image_2.png']);
    });

    it('should try the names it is given when the first one is taken', async () => {
      const target = path.join(testDir, 'img_001.png');
      await fs.writeFile(target, 'first');

      const result = await writer.writeAtomic(target, Buffer.from('second'), {
        nextName: (attempt) => `img_${String(attempt + 1).padStart(3, '0')}.png`,
      });

      expect(result.absolutePath).toBe(path.join(testDir, 'img_002.png'));
      expect(await fs.readFile(target, 'utf8')).toBe('first');
    });

    it('should not replace a directory at the name', async () => {
      const target = path.join(testDir, 'image.png');
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, 'inside.txt'), 'keep');

      const result = await writer.writeAtomic(target, Buffer.from('image'));

      expect(result.absolutePath).toBe(path.join(testDir, 'image_1.png'));
      expect(await fs.readFile(path.join(target, 'inside.txt'), 'utf8')).toBe('keep');
    });

    it('should give each of several writers saving the same name a file of its own', async () => {
      const target = path.join(testDir, 'image.png');
      const images = Array.from({ length: 12 }, (_, i) => Buffer.alloc(4096, i));

      const results = await Promise.all(
        images.map((image) => new FileWriter(testDir).writeAtomic(target, image))
      );

      expect(new Set(results.map((result) => result.absolutePath)).size).toBe(images.length);
      for (const [i, result] of results.entries()) {
        expect(await fs.readFile(result.absolutePath)).toEqual(images[i]);
      }
      expect(await fs.readdir(testDir)).toHaveLength(images.length);
    });

    it('should give up after a bounded number of names, leaving the existing file', async () => {
      const target = path.join(testDir, 'image.png');
      await fs.writeFile(target, 'keep');
      vi.mocked(fs.link).mockRejectedValue(systemError('EEXIST'));

      await expect(writer.writeAtomic(target, Buffer.from('new'))).rejects.toThrow('No free file name');

      expect(fs.copyFile).not.toHaveBeenCalled();
      expect(await fs.readFile(target, 'utf8')).toBe('keep');
      expect(await fs.readdir(testDir)).toEqual(['image.png']);
    });

    it('should keep a finished save when the temporary file cannot be removed', async () => {
      vi.mocked(fs.unlink).mockRejectedValueOnce(systemError('EBUSY'));

      const result = await writer.writeAtomic(path.join(testDir, 'image.png'), Buffer.from('complete'));

      expect(await fs.readFile(result.absolutePath, 'utf8')).toBe('complete');
    });
  });

  /**
   * FAT, exFAT and some network shares cannot make hard links
   */
  describe('writeAtomic without hard links', () => {
    it.each(['EPERM', 'ENOTSUP', 'EISDIR', 'EINVAL'])(
      'should copy instead when linking fails with %s, without replacing anything',
      async (code) => {
        const target = path.join(testDir, 'image.png');
        await fs.writeFile(target, 'keep');
        vi.mocked(fs.link).mockRejectedValue(systemError(code));

        const result = await writer.writeAtomic(target, Buffer.from('new'));

        expect(result.absolutePath).toBe(path.join(testDir, 'image_1.png'));
        expect(await fs.readFile(result.absolutePath, 'utf8')).toBe('new');
        expect(await fs.readFile(target, 'utf8')).toBe('keep');
        expect((await fs.readdir(testDir)).sort()).toEqual(['image.png', 'image_1.png']);
      }
    );

    it('should give each of several writers a file of its own when copying', async () => {
      vi.mocked(fs.link).mockRejectedValue(systemError('ENOTSUP'));
      const target = path.join(testDir, 'image.png');
      const images = Array.from({ length: 12 }, (_, i) => Buffer.alloc(4096, i));

      const results = await Promise.all(images.map((image) => writer.writeAtomic(target, image)));

      expect(new Set(results.map((result) => result.absolutePath)).size).toBe(images.length);
      for (const [i, result] of results.entries()) {
        expect(await fs.readFile(result.absolutePath)).toEqual(images[i]);
      }
      expect(await fs.readdir(testDir)).toHaveLength(images.length);
    });

    it('should not report the save before the copy has finished', async () => {
      const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
      vi.mocked(fs.link).mockRejectedValue(systemError('ENOTSUP'));
      let release!: () => void;
      const copying = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const copyStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      vi.mocked(fs.copyFile).mockImplementationOnce(async (...args) => {
        started();
        await copying;
        await actual.copyFile(...args);
      });

      let settled = false;
      const pending = writer.writeAtomic(path.join(testDir, 'image.png'), Buffer.from('complete'));
      void pending.then(() => {
        settled = true;
      });
      await copyStarted;
      expect(settled).toBe(false);

      release();
      const result = await pending;
      expect(await fs.readFile(result.absolutePath, 'utf8')).toBe('complete');
    });

    it('should report a failed copy and leave the file at the name alone', async () => {
      const target = path.join(testDir, 'image.png');
      await fs.writeFile(target, 'keep');
      vi.mocked(fs.link).mockRejectedValue(systemError('ENOTSUP'));
      vi.mocked(fs.copyFile).mockRejectedValueOnce(systemError('EACCES'));

      await expect(writer.writeAtomic(target, Buffer.from('new'))).rejects.toThrow('EACCES');

      expect(await fs.readFile(target, 'utf8')).toBe('keep');
      expect(await fs.readdir(testDir)).toEqual(['image.png']);
    });

    it('should step past a directory that the copy reports as EPERM, as Windows does', async () => {
      const target = path.join(testDir, 'image.png');
      await fs.mkdir(target);
      vi.mocked(fs.link).mockRejectedValue(systemError('ENOTSUP'));
      vi.mocked(fs.copyFile).mockRejectedValueOnce(systemError('EPERM'));

      const result = await writer.writeAtomic(target, Buffer.from('new'));

      expect(result.absolutePath).toBe(path.join(testDir, 'image_1.png'));
      expect(await fs.readFile(result.absolutePath, 'utf8')).toBe('new');
    });

    it.each(['no file', 'a file'])(
      'should report EPERM from the copy when there is %s at the name',
      async (what) => {
        const target = path.join(testDir, 'image.png');
        if (what === 'a file') {
          await fs.writeFile(target, 'keep');
        }
        vi.mocked(fs.link).mockRejectedValue(systemError('ENOTSUP'));
        vi.mocked(fs.copyFile).mockRejectedValueOnce(systemError('EPERM'));

        await expect(writer.writeAtomic(target, Buffer.from('new'))).rejects.toThrow('EPERM');

        expect(fs.copyFile).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe('exists', () => {
    it('should return true for existing files', async () => {
      const filePath = path.join(testDir, 'exists.txt');
      await fs.writeFile(filePath, 'test');

      const result = await writer.exists(filePath);
      expect(result).toBe(true);
    });

    it('should return false for non-existing files', async () => {
      const filePath = path.join(testDir, 'not-exists.txt');

      const result = await writer.exists(filePath);
      expect(result).toBe(false);
    });
  });

  describe('deleteIfExists', () => {
    it('should delete existing file and return true', async () => {
      const filePath = path.join(testDir, 'to-delete.txt');
      await fs.writeFile(filePath, 'test');

      const result = await writer.deleteIfExists(filePath);
      expect(result).toBe(true);

      const exists = await writer.exists(filePath);
      expect(exists).toBe(false);
    });

    it('should return false for non-existing file', async () => {
      const filePath = path.join(testDir, 'not-exists.txt');

      const result = await writer.deleteIfExists(filePath);
      expect(result).toBe(false);
    });
  });

  describe('ensureDir', () => {
    it('should create directory', async () => {
      const dirPath = path.join(testDir, 'new-dir');

      await writer.ensureDir(dirPath);

      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create nested directories', async () => {
      const dirPath = path.join(testDir, 'a', 'b', 'c');

      await writer.ensureDir(dirPath);

      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should not throw if directory already exists', async () => {
      const dirPath = path.join(testDir, 'existing');
      await fs.mkdir(dirPath);

      await expect(writer.ensureDir(dirPath)).resolves.not.toThrow();
    });
  });

  describe('getWorkspaceRoot', () => {
    it('should return workspace root', () => {
      expect(writer.getWorkspaceRoot()).toBe(testDir);
    });
  });
});
