/**
 * Secure temporary file management
 * Prevents TOCTOU vulnerabilities and ensures cleanup
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { FileOperationError } from '../core/errors';
import { TEMP_FILE_PREFIX, TIMEOUTS } from '../core/constants';
import { getPlatform } from './sanitizer';

/**
 * Manager for secure temporary file operations
 * Uses cryptographically secure random names and exclusive file creation
 */
export class TempFileManager {
  private readonly tempDir: string;
  private readonly activeFiles: Set<string> = new Set();
  private isDisposed: boolean = false;
  private isInitialized: boolean = false;

  constructor() {
    const platform = getPlatform();

    // Use platform-specific temp directory
    if (platform === 'win32') {
      // Use LOCALAPPDATA for better isolation on Windows
      const localAppData = process.env['LOCALAPPDATA'];
      if (localAppData !== undefined && localAppData !== '') {
        this.tempDir = path.join(localAppData, 'clipshot', 'temp');
      } else {
        this.tempDir = path.join(os.tmpdir(), 'clipshot', 'temp');
      }
    } else {
      // Unix: use user-specific temp directory
      this.tempDir = path.join(os.tmpdir(), `clipshot-${os.userInfo().uid}`);
    }
  }

  /**
   * Initialize the temp directory with proper permissions
   *
   * Skipped once the directory has been created; createSecureTempFile
   * re-initializes if the directory disappears mid-session.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    await fs.mkdir(this.tempDir, { recursive: true, mode: 0o700 });
    this.isInitialized = true;
  }

  /**
   * Generate a cryptographically secure random file name
   */
  private generateSecureFileName(extension: string): string {
    const randomBytes = crypto.randomBytes(16);
    const hexString = randomBytes.toString('hex');
    return `${TEMP_FILE_PREFIX}${hexString}${extension}`;
  }

  /**
   * Create a secure temporary file
   * Uses O_CREAT | O_EXCL to prevent TOCTOU vulnerabilities
   *
   * @param extension - File extension (e.g., '.png')
   * @returns Path to the created temporary file
   */
  public async createSecureTempFile(extension: string): Promise<string> {
    if (this.isDisposed) {
      throw new FileOperationError('TempFileManager has been disposed');
    }

    await this.initialize();

    // Try multiple times in case of collision (extremely unlikely)
    for (let attempt = 0; attempt < 3; attempt++) {
      const fileName = this.generateSecureFileName(extension);
      const filePath = path.join(this.tempDir, fileName);

      try {
        // O_CREAT | O_EXCL: Create file exclusively (fails if exists)
        // This prevents TOCTOU race conditions
        const handle = await fs.open(filePath, 'wx', 0o600);
        await handle.close();

        this.activeFiles.add(filePath);
        return filePath;
      } catch (error) {
        // EEXIST means file already exists (extremely unlikely with 16 random bytes)
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          continue;
        }
        // Temp dir was removed after initialization — recreate and retry
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.isInitialized = false;
          await this.initialize();
          continue;
        }
        throw new FileOperationError(
          `Failed to create temp file: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    throw new FileOperationError('Failed to create temp file after multiple attempts');
  }

  /**
   * Write data to a temporary file securely
   *
   * @param data - Data to write
   * @param extension - File extension
   * @returns Path to the created file
   */
  public async writeTempFile(data: Buffer, extension: string): Promise<string> {
    const filePath = await this.createSecureTempFile(extension);

    try {
      await fs.writeFile(filePath, data, { mode: 0o600 });
      return filePath;
    } catch (error) {
      // Clean up on failure
      await this.cleanup(filePath);
      throw new FileOperationError(
        `Failed to write temp file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Read a temporary file
   *
   * @param filePath - Path to the file
   * @returns File contents as Buffer
   */
  public async readTempFile(filePath: string): Promise<Buffer> {
    if (!this.activeFiles.has(filePath)) {
      throw new FileOperationError('File is not managed by this TempFileManager');
    }

    try {
      return await fs.readFile(filePath);
    } catch (error) {
      throw new FileOperationError(
        `Failed to read temp file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clean up a specific temporary file
   *
   * @param filePath - Path to the file to clean up
   */
  public async cleanup(filePath: string): Promise<void> {
    if (!this.activeFiles.has(filePath)) {
      return; // Not our file, don't touch it
    }

    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore errors during cleanup (best-effort)
      // ENOENT means file was already deleted
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Silently ignore - cleanup failures are not critical
      }
    } finally {
      this.activeFiles.delete(filePath);
    }
  }

  /**
   * Clean up all temporary files managed by this instance
   */
  public async cleanupAll(): Promise<void> {
    const files = Array.from(this.activeFiles);
    await Promise.allSettled(files.map((f) => this.cleanup(f)));
  }

  /**
   * Schedule automatic cleanup after a delay
   *
   * @param filePath - Path to the file
   * @param delayMs - Delay in milliseconds (default: 5000)
   */
  public scheduleCleanup(filePath: string, delayMs: number = TIMEOUTS.TEMP_FILE_CLEANUP): void {
    setTimeout(() => {
      void this.cleanup(filePath);
    }, delayMs);
  }

  /**
   * Dispose of the manager and clean up all files
   */
  public async dispose(): Promise<void> {
    this.isDisposed = true;
    await this.cleanupAll();
  }

  /**
   * Get the temp directory path
   */
  public getTempDir(): string {
    return this.tempDir;
  }

  /**
   * Get count of active temp files
   */
  public getActiveFileCount(): number {
    return this.activeFiles.size;
  }
}

// Singleton instance for global use
let globalTempFileManager: TempFileManager | null = null;

/**
 * Get the global TempFileManager instance
 */
export function getTempFileManager(): TempFileManager {
  if (!globalTempFileManager) {
    globalTempFileManager = new TempFileManager();
  }
  return globalTempFileManager;
}

/**
 * Dispose of the global TempFileManager instance
 */
export async function disposeGlobalTempFileManager(): Promise<void> {
  if (globalTempFileManager) {
    await globalTempFileManager.dispose();
    globalTempFileManager = null;
  }
}
