/**
 * File writer
 * Writes a complete file under a name nothing else has, never over an existing one
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { FileOperationError } from '../core/errors';
import { ATOMIC_WRITE_SUFFIX } from '../core/constants';
import { validatePathInsideWorkspace } from '../security/path-validator';
import { withNameSuffix } from './path-generator';

/**
 * How many names one write tries before it gives up
 */
const MAX_NAME_ATTEMPTS = 10_000;

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
  /**
   * The file name to try, in the same directory, when the one before it is
   * taken; called with 1, 2, … - default: `_1`, `_2`, … before the extension
   */
  nextName?: (attempt: number) => string;
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
   * Write data to a new file, never replacing one that exists
   *
   * The data goes to a temporary file first, which is then hard-linked to the
   * target name: a link appears complete or not at all, and it fails rather
   * than replace whatever is at the name — also when another process is
   * writing there at the same moment. When the name is taken, the next one is
   * tried. On a file system that cannot link, the file is copied with
   * COPYFILE_EXCL instead, which does not replace anything either, though the
   * file is visible under its name while it is copied.
   *
   * @param filePath - Absolute path to target file
   * @param data - Data to write
   * @param options - Write options
   * @returns Write result with the path actually written
   */
  async writeAtomic(
    filePath: string,
    data: Buffer,
    options: AtomicWriteOptions = {}
  ): Promise<WriteResult> {
    const { mode = 0o644, createDirs = true, dirMode = 0o755 } = options;
    const nextName =
      options.nextName ?? ((attempt: number): string => withNameSuffix(path.basename(filePath), attempt));

    // Validate path is inside workspace. The names tried after this one are in
    // the same directory, and neither a link nor an exclusive copy follows a
    // symlink that is already at a name: they fail as taken.
    await validatePathInsideWorkspace(filePath, this.workspaceRoot);

    const dir = path.dirname(filePath);
    const tempPath = this.generateTempPath(filePath);
    let tempCreated = false;

    try {
      // Create parent directories if needed
      if (createDirs) {
        await fs.mkdir(dir, { recursive: true, mode: dirMode });
      }

      // Write to temp file first. `wx`: a name only this write uses
      const handle = await fs.open(tempPath, 'wx', mode);
      tempCreated = true;
      try {
        await handle.writeFile(data);
      } finally {
        await handle.close();
      }

      let copying = false;
      for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
        const candidate = attempt === 0 ? filePath : path.join(dir, nextName(attempt));
        try {
          if (!copying) {
            try {
              await fs.link(tempPath, candidate);
              return { absolutePath: candidate, fileSize: data.length };
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                continue;
              }
              // FAT, exFAT and some network shares have no hard links. Any
              // other failure is tried as a copy too: a copy that cannot work
              // either reports its own error.
              copying = true;
            }
          }
          await fs.copyFile(tempPath, candidate, fs.constants.COPYFILE_EXCL);
          return { absolutePath: candidate, fileSize: data.length };
        } catch (error) {
          if (await this.isTaken(error, candidate)) {
            continue;
          }
          throw error;
        }
      }
      throw new Error(`No free file name after ${String(MAX_NAME_ATTEMPTS)} attempts`);
    } catch (error) {
      throw new FileOperationError(
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
        'Failed to save image file'
      );
    } finally {
      // The image has its own name by now, or the write failed. Either way the
      // temporary name goes; failing to remove it does not undo a save. Only a
      // temp file this write created is removed.
      if (tempCreated) {
        await fs.unlink(tempPath).catch(() => undefined);
      }
    }
  }

  /**
   * Whether a failed copy failed because the name is in use
   *
   * Windows reports a directory at the name as EPERM rather than EEXIST, so a
   * permission error counts only when a directory is there. That is looked up
   * after the failure; the next attempt still copies exclusively.
   */
  private async isTaken(error: unknown, candidate: string): Promise<boolean> {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return true;
    }
    if (code !== 'EPERM' && code !== 'EISDIR') {
      return false;
    }
    try {
      return (await fs.lstat(candidate)).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Generate a unique temp file path
   */
  private generateTempPath(targetPath: string): string {
    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const base = path.basename(targetPath, ext);
    const random = crypto.randomBytes(16).toString('hex');

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
