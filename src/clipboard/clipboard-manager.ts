/**
 * Clipboard manager - factory for platform-specific providers
 */

import type { ClipboardData, Platform, Logger } from '../core/types';
import { PlatformNotSupportedError, ClipboardError } from '../core/errors';
import { getPlatform } from '../security/sanitizer';
import type { IClipboardProvider } from './clipboard-provider';
import { WindowsClipboardProvider } from './providers/windows-provider';
import { MacOSClipboardProvider } from './providers/macos-provider';
import { LinuxClipboardProvider } from './providers/linux-provider';

/**
 * Factory function to create a clipboard provider for the current platform
 */
export function createClipboardProvider(): IClipboardProvider {
  const platform = getPlatform();

  switch (platform) {
    case 'win32':
      return new WindowsClipboardProvider();
    case 'darwin':
      return new MacOSClipboardProvider();
    case 'linux':
      return new LinuxClipboardProvider();
    default:
      throw new PlatformNotSupportedError(platform);
  }
}

/**
 * Clipboard manager that wraps the platform-specific provider
 * Provides a consistent interface and handles errors
 */
export class ClipboardManager {
  private readonly provider: IClipboardProvider;
  private readonly platform: Platform;
  private readonly logger?: Logger;

  constructor(provider?: IClipboardProvider, logger?: Logger) {
    this.platform = getPlatform();
    this.provider = provider ?? createClipboardProvider();
    this.logger = logger;
  }

  /**
   * Check if the clipboard provider is available on the current system
   *
   * Verifies that the platform-specific clipboard tool (PowerShell, osascript,
   * xclip, or wl-paste) is installed and accessible.
   *
   * @returns True if clipboard access is available, false otherwise
   */
  async isAvailable(): Promise<boolean> {
    this.logger?.debug('Checking clipboard availability', { platform: this.platform });
    try {
      const available = await this.provider.isAvailable();
      this.logger?.debug('Clipboard availability result', { available });
      return available;
    } catch (error) {
      this.logger?.warn('Clipboard availability check failed', error);
      return false;
    }
  }

  /**
   * Check if clipboard currently contains an image
   *
   * Queries the system clipboard to determine if image data is available.
   * This is a quick check that doesn't read the actual image data.
   *
   * @returns True if clipboard contains an image, false otherwise
   */
  async hasImage(): Promise<boolean> {
    this.logger?.debug('Checking if clipboard has image');
    try {
      const hasImage = await this.provider.hasImage();
      this.logger?.debug('Clipboard hasImage result', { hasImage });
      return hasImage;
    } catch (error) {
      this.logger?.warn('Clipboard hasImage check failed', error);
      return false;
    }
  }

  /**
   * Get image data from clipboard
   *
   * Reads the clipboard contents and extracts image data if available.
   * The image is saved to a temporary file and read as a buffer.
   *
   * @returns ClipboardData with image buffer if available
   * @throws ClipboardError if clipboard access is unavailable or reading fails
   */
  async getImageData(): Promise<ClipboardData> {
    this.logger?.debug('Getting image data from clipboard');
    const isAvailable = await this.isAvailable();
    if (!isAvailable) {
      throw new ClipboardError(
        `Clipboard provider not available on ${this.platform}`,
        'Clipboard access is not available'
      );
    }

    const data = await this.provider.getImageData();
    this.logger?.debug('Image data retrieved', {
      hasImage: data.hasImage,
      size: data.imageBuffer?.length ?? 0,
    });
    return data;
  }

  /**
   * Clean up any temporary resources created by clipboard operations
   *
   * Removes temporary files created during image extraction.
   * Should be called after the image data is no longer needed.
   */
  async cleanup(): Promise<void> {
    this.logger?.debug('Cleaning up clipboard resources');
    await this.provider.cleanup();
  }

  /**
   * Get the current operating system platform
   *
   * @returns Platform identifier ('win32', 'darwin', or 'linux')
   */
  getPlatform(): Platform {
    return this.platform;
  }

  /**
   * Get the name of the active clipboard provider
   *
   * @returns Provider name (e.g., 'windows', 'macos', 'linux')
   */
  getProviderName(): string {
    return this.provider.getPlatform();
  }
}

// Singleton instance
let globalClipboardManager: ClipboardManager | null = null;

/**
 * Get the global ClipboardManager instance
 *
 * @param logger - Optional logger instance for debugging
 */
export function getClipboardManager(logger?: Logger): ClipboardManager {
  if (!globalClipboardManager) {
    globalClipboardManager = new ClipboardManager(undefined, logger);
  }
  return globalClipboardManager;
}

/**
 * Dispose of the global ClipboardManager instance
 */
export async function disposeGlobalClipboardManager(): Promise<void> {
  if (globalClipboardManager) {
    await globalClipboardManager.cleanup();
    globalClipboardManager = null;
  }
}
