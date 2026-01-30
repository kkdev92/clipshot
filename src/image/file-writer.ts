/**
 * Atomic file writer
 * Writes files safely using temp file + rename pattern
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { FileOperationError } from '../core/errors';
import { ATOMIC_WRITE_SUFFIX } from '../core/constants';
import { validatePathInsideWorkspace } from '../security/path-validator';

/**
 * Options for atomic write
 */
export interface AtomicWriteOptions {
  /** File mode (permissions) - default: 0o644 */
  mode?: number;
  /** Whether to create parent directories - default: true */
  createDirs?: boolean;
  /** Directory permissions when creating - default: 0o755 */
  dirMode?: number;
}

/**
 * Result of atomic write operation
 */
export interface WriteResult {
  /** Absolute path to written file */
  absolutePath: string;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Atomic file writer class
 */
export class FileWriter {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Write data to a file atomically
   * Uses write-to-temp + rename pattern to prevent partial writes
   *
   * @param filePath - Absolute path to target file
   * @param data - Data to write
   * @param options - Write options
   * @returns Write result with file info
   */
  async writeAtomic(
    filePath: string,
    data: Buffer,
    options: AtomicWriteOptions = {}
  ): Promise<WriteResult> {
    const { mode = 0o644, createDirs = true, dirMode = 0o755 } = options;

    // Validate path is inside workspace
    await validatePathInsideWorkspace(filePath, this.workspaceRoot);

    const dir = path.dirname(filePath);
    const tempPath = this.generateTempPath(filePath);

    try {
      // Create parent directories if needed
      if (createDirs) {
        await fs.mkdir(dir, { recursive: true, mode: dirMode });
      }

      // Write to temp file first
      await fs.writeFile(tempPath, data, { mode });

      // Rename temp to final (atomic operation on most filesystems)
      await fs.rename(tempPath, filePath);

      // Get file stats
      const stats = await fs.stat(filePath);

      return {
        absolutePath: filePath,
        fileSize: stats.size,
      };
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw new FileOperationError(
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
        'Failed to save image file'
      );
    }
  }

  /**
   * Generate a unique temp file path
   */
  private generateTempPath(targetPath: string): string {
    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const base = path.basename(targetPath, ext);
    const random = crypto.randomBytes(8).toString('hex');

    return path.join(dir, `${base}_${random}${ATOMIC_WRITE_SUFFIX}`);
  }

  /**
   * Check if a file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file if it exists
   */
  async deleteIfExists(filePath: string): Promise<boolean> {
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw new FileOperationError(
        `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Ensure a directory exists
   */
  async ensureDir(dirPath: string, mode: number = 0o755): Promise<void> {
    await validatePathInsideWorkspace(dirPath, this.workspaceRoot);
    await fs.mkdir(dirPath, { recursive: true, mode });
  }

  /**
   * Get the workspace root
   */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}
