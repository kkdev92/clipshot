import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import {
  TempFileManager,
  getTempFileManager,
  disposeGlobalTempFileManager,
} from '../../src/security/temp-file-manager';

describe('TempFileManager', () => {
  let manager: TempFileManager;

  beforeEach(() => {
    manager = new TempFileManager();
  });

  afterEach(async () => {
    await manager.dispose();
  });

  describe('createSecureTempFile', () => {
    it('should create a temp file with correct extension', async () => {
      const filePath = await manager.createSecureTempFile('.png');

      expect(filePath).toMatch(/\.png$/);

      // Verify file exists
      const stats = await fs.stat(filePath);
      expect(stats.isFile()).toBe(true);
    });

    it('should create unique file names', async () => {
      const path1 = await manager.createSecureTempFile('.png');
      const path2 = await manager.createSecureTempFile('.png');

      expect(path1).not.toBe(path2);
    });

    it('should include clipshot prefix in filename', async () => {
      const filePath = await manager.createSecureTempFile('.png');
      const fileName = filePath.split(/[\\/]/).pop() ?? '';

      expect(fileName).toMatch(/^clipshot_/);
    });

    it('should throw after dispose', async () => {
      await manager.dispose();

      await expect(manager.createSecureTempFile('.png')).rejects.toThrow('disposed');
    });
  });

  describe('writeTempFile', () => {
    it('should write data to temp file', async () => {
      const testData = Buffer.from('test image data');

      const filePath = await manager.writeTempFile(testData, '.dat');

      const readData = await fs.readFile(filePath);
      expect(readData).toEqual(testData);
    });
  });

  describe('readTempFile', () => {
    it('should read managed temp file', async () => {
      const testData = Buffer.from('test data');
      const filePath = await manager.writeTempFile(testData, '.dat');

      const readData = await manager.readTempFile(filePath);
      expect(readData).toEqual(testData);
    });

    it('should throw for unmanaged files', async () => {
      const unmanagedPath = '/tmp/not-managed-file.txt';

      await expect(manager.readTempFile(unmanagedPath)).rejects.toThrow('not managed');
    });
  });

  describe('cleanup', () => {
    it('should remove specified temp file', async () => {
      const filePath = await manager.createSecureTempFile('.png');

      await manager.cleanup(filePath);

      // Verify file is deleted
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should not throw for already deleted files', async () => {
      const filePath = await manager.createSecureTempFile('.png');
      await fs.unlink(filePath);

      // Should not throw
      await expect(manager.cleanup(filePath)).resolves.not.toThrow();
    });

    it('should ignore unmanaged files', async () => {
      const unmanagedPath = '/tmp/unmanaged.txt';

      // Should not throw, just ignore
      await expect(manager.cleanup(unmanagedPath)).resolves.not.toThrow();
    });
  });

  describe('cleanupAll', () => {
    it('should remove all managed temp files', async () => {
      const paths = [
        await manager.createSecureTempFile('.png'),
        await manager.createSecureTempFile('.jpg'),
        await manager.createSecureTempFile('.dat'),
      ];

      await manager.cleanupAll();

      // Verify all files are deleted
      for (const filePath of paths) {
        await expect(fs.access(filePath)).rejects.toThrow();
      }
    });
  });

  describe('dispose', () => {
    it('should cleanup all files on dispose', async () => {
      const filePath = await manager.createSecureTempFile('.png');

      await manager.dispose();

      // Verify file is deleted
      await expect(fs.access(filePath)).rejects.toThrow();
    });
  });

  describe('getTempDir', () => {
    it('should return temp directory path', () => {
      const tempDir = manager.getTempDir();

      expect(typeof tempDir).toBe('string');
      expect(tempDir.length).toBeGreaterThan(0);
    });
  });

  describe('getActiveFileCount', () => {
    it('should return 0 initially', () => {
      expect(manager.getActiveFileCount()).toBe(0);
    });

    it('should track active files', async () => {
      await manager.createSecureTempFile('.png');
      expect(manager.getActiveFileCount()).toBe(1);

      await manager.createSecureTempFile('.jpg');
      expect(manager.getActiveFileCount()).toBe(2);
    });

    it('should decrease after cleanup', async () => {
      const filePath = await manager.createSecureTempFile('.png');
      expect(manager.getActiveFileCount()).toBe(1);

      await manager.cleanup(filePath);
      expect(manager.getActiveFileCount()).toBe(0);
    });
  });

  describe('scheduleCleanup', () => {
    it('should schedule cleanup after delay', async () => {
      const filePath = await manager.createSecureTempFile('.png');
      expect(manager.getActiveFileCount()).toBe(1);

      // Schedule with short delay for testing
      manager.scheduleCleanup(filePath, 50);

      // File should still exist immediately after scheduling
      expect(manager.getActiveFileCount()).toBe(1);

      // Wait for the actual delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      // After delay, file should be cleaned up
      expect(manager.getActiveFileCount()).toBe(0);
    });

    it('should not throw when scheduling cleanup for valid file', async () => {
      const filePath = await manager.createSecureTempFile('.png');

      // Should not throw
      expect(() => manager.scheduleCleanup(filePath, 10000)).not.toThrow();

      // Clean up manually since delay is long
      await manager.cleanup(filePath);
    });
  });

  describe('readTempFile error handling', () => {
    it('should throw when reading deleted temp file', async () => {
      const filePath = await manager.createSecureTempFile('.png');
      // Delete the file directly (simulating external deletion)
      await fs.unlink(filePath);

      // Note: The file is still in activeFiles set, so it won't throw "not managed"
      // Instead it should throw a read error
      await expect(manager.readTempFile(filePath)).rejects.toThrow('Failed to read');
    });
  });
});

describe('Global TempFileManager', () => {
  afterEach(async () => {
    await disposeGlobalTempFileManager();
  });

  describe('getTempFileManager', () => {
    it('should return a TempFileManager instance', () => {
      const manager = getTempFileManager();

      expect(manager).toBeInstanceOf(TempFileManager);
    });

    it('should return the same instance on subsequent calls', () => {
      const manager1 = getTempFileManager();
      const manager2 = getTempFileManager();

      expect(manager1).toBe(manager2);
    });
  });

  describe('disposeGlobalTempFileManager', () => {
    it('should dispose the global manager', async () => {
      const manager = getTempFileManager();
      const filePath = await manager.createSecureTempFile('.png');

      await disposeGlobalTempFileManager();

      // File should be cleaned up
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should allow creating new manager after dispose', async () => {
      const manager1 = getTempFileManager();
      await disposeGlobalTempFileManager();

      const manager2 = getTempFileManager();

      // Should be different instance
      expect(manager2).toBeInstanceOf(TempFileManager);
    });

    it('should handle multiple dispose calls gracefully', async () => {
      getTempFileManager();

      // Should not throw
      await expect(disposeGlobalTempFileManager()).resolves.not.toThrow();
      await expect(disposeGlobalTempFileManager()).resolves.not.toThrow();
    });
  });
});
