import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileWriter } from '../../src/image/file-writer';

describe('FileWriter', () => {
  let testDir: string;
  let writer: FileWriter;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipshot-test-'));
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
