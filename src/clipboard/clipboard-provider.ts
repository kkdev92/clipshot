/**
 * Abstract interface for clipboard providers
 * Allows platform-specific implementations
 */

import type { ClipboardData } from '../core/types';
import { PNG_SIGNATURE, JPEG_SIGNATURE } from '../core/constants';

/**
 * Interface for clipboard image providers
 * Each platform implements this interface with native clipboard access
 */
export interface IClipboardProvider {
  /**
   * Check if clipboard contains an image
   */
  hasImage(): Promise<boolean>;

  /**
   * Get image data from clipboard
   * @returns ClipboardData with image buffer if available
   */
  getImageData(): Promise<ClipboardData>;

  /**
   * Clean up any temporary resources
   */
  cleanup(): Promise<void>;

  /**
   * Get the platform name for this provider
   */
  getPlatform(): string;

  /**
   * Check if this provider is available on the current system
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Result from clipboard operation
 */
export interface ClipboardOperationResult {
  success: boolean;
  data?: ClipboardData;
  error?: string;
}

/**
 * Abstract base class for clipboard providers
 * Provides common functionality
 */
export abstract class BaseClipboardProvider implements IClipboardProvider {
  protected readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract hasImage(): Promise<boolean>;
  abstract getImageData(): Promise<ClipboardData>;
  abstract cleanup(): Promise<void>;
  abstract isAvailable(): Promise<boolean>;

  getPlatform(): string {
    return this.name;
  }

  /**
   * Create an empty clipboard data object
   */
  protected createEmptyClipboardData(): ClipboardData {
    return {
      hasImage: false,
      hasText: false,
      imageBuffer: null,
      format: null,
    };
  }

  /**
   * Detect image format from buffer magic bytes
   *
   * @param buffer - Image data buffer
   * @returns Detected format ('png' or 'jpeg') or null if unknown
   */
  protected detectImageFormat(buffer: Buffer): 'png' | 'jpeg' | null {
    if (buffer.length < PNG_SIGNATURE.length) {
      return null;
    }

    // Check PNG signature
    if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return 'png';
    }

    // Check JPEG signature
    if (buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
      return 'jpeg';
    }

    return null;
  }
}
