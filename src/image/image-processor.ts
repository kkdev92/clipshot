/**
 * Image processor using Sharp
 * Handles format conversion, optimization, and metadata extraction
 */

import type { ImageFormat, ProcessedImage, ImageDimensions } from '../core/types';
import { ImageProcessingError, FileSizeLimitError } from '../core/errors';
import { PathGenerator } from './path-generator';
import { FileWriter } from './file-writer';

// Sharp is dynamically imported to handle cases where it's not available
type SharpInstance = {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  png(options?: { compressionLevel?: number; progressive?: boolean }): SharpInstance;
  jpeg(options?: { quality?: number; progressive?: boolean; mozjpeg?: boolean }): SharpInstance;
  webp(options?: { quality?: number }): SharpInstance;
  toBuffer(): Promise<Buffer>;
};

type SharpModule = {
  default: (input: Buffer) => SharpInstance;
};

let sharpModule: SharpModule | null = null;
let sharpLoadAttempted = false;

/**
 * Try to load Sharp module
 */
async function loadSharp(): Promise<SharpModule | null> {
  if (sharpLoadAttempted) {
    return sharpModule;
  }

  sharpLoadAttempted = true;

  try {
    // Dynamic import to handle cases where Sharp is not available
    sharpModule = (await import('sharp')) as SharpModule;
    return sharpModule;
  } catch {
    // Sharp not available (e.g., ARM64 without prebuilt binary)
    return null;
  }
}

/**
 * Image processing options
 */
export interface ImageProcessorOptions {
  /** Output format */
  format: ImageFormat;
  /** JPEG quality (1-100) */
  jpegQuality: number;
  /** WebP quality (1-100) */
  webpQuality: number;
  /** Maximum file size in MB */
  maxFileSizeMB: number;
}

/**
 * Image processor class
 */
export class ImageProcessor {
  private readonly pathGenerator: PathGenerator;
  private readonly fileWriter: FileWriter;

  constructor(workspaceRoot: string) {
    this.pathGenerator = new PathGenerator(workspaceRoot);
    this.fileWriter = new FileWriter(workspaceRoot);
  }

  /**
   * Process and save an image
   *
   * @param imageBuffer - Raw image data
   * @param saveDirectory - Directory to save to (relative to workspace)
   * @param fileNamePattern - File name pattern
   * @param options - Processing options
   * @returns Processed image result
   */
  async processAndSave(
    imageBuffer: Buffer,
    saveDirectory: string,
    fileNamePattern: string,
    options: ImageProcessorOptions
  ): Promise<ProcessedImage> {
    // Check initial buffer size
    const initialSizeMB = imageBuffer.length / (1024 * 1024);
    if (initialSizeMB > options.maxFileSizeMB) {
      throw new FileSizeLimitError(initialSizeMB, options.maxFileSizeMB);
    }

    // Process the image
    const { processedBuffer, dimensions } = await this.processImage(imageBuffer, options);

    // Check processed size
    const processedSizeMB = processedBuffer.length / (1024 * 1024);
    if (processedSizeMB > options.maxFileSizeMB) {
      throw new FileSizeLimitError(processedSizeMB, options.maxFileSizeMB);
    }

    // Generate file name
    const fileName = this.pathGenerator.generateFileName(fileNamePattern, options.format);

    // Generate save path
    const savePath = this.pathGenerator.generateSavePath(saveDirectory, fileName);

    // Write the file
    const writeResult = await this.fileWriter.writeAtomic(savePath, processedBuffer);

    // Generate relative path
    const relativePath = this.pathGenerator.generateRelativePath(writeResult.absolutePath);

    return {
      absolutePath: writeResult.absolutePath,
      relativePath,
      fileName,
      fileSize: writeResult.fileSize,
      format: options.format,
      dimensions,
    };
  }

  /**
   * Process image buffer (convert format, optimize)
   *
   * Attempts to use Sharp for full processing capabilities.
   * Falls back to pass-through mode if Sharp is unavailable.
   *
   * @param buffer - Raw image data buffer
   * @param options - Processing options (format, quality)
   * @returns Processed buffer and dimensions
   */
  private async processImage(
    buffer: Buffer,
    options: ImageProcessorOptions
  ): Promise<{ processedBuffer: Buffer; dimensions: ImageDimensions | null }> {
    const sharp = await loadSharp();

    if (sharp) {
      return this.processWithSharp(sharp, buffer, options);
    } else {
      return this.processWithoutSharp(buffer, options);
    }
  }

  /**
   * Process image using Sharp library
   *
   * Provides full image processing capabilities including:
   * - Format conversion (PNG, JPEG, WebP)
   * - Quality optimization
   * - Metadata extraction (dimensions)
   *
   * @param sharp - Sharp module reference
   * @param buffer - Raw image data buffer
   * @param options - Processing options
   * @returns Processed buffer and extracted dimensions
   * @throws ImageProcessingError if Sharp processing fails
   */
  private async processWithSharp(
    sharp: SharpModule,
    buffer: Buffer,
    options: ImageProcessorOptions
  ): Promise<{ processedBuffer: Buffer; dimensions: ImageDimensions | null }> {
    try {
      const image = sharp.default(buffer);

      // Get metadata
      const metadata = await image.metadata();
      const dimensions: ImageDimensions | null =
        metadata.width !== undefined && metadata.width !== 0 && metadata.height !== undefined && metadata.height !== 0
          ? { width: metadata.width, height: metadata.height }
          : null;

      // Convert to desired format
      let processedImage: SharpInstance;

      if (options.format === 'png') {
        processedImage = image.png({
          compressionLevel: 6,
          progressive: false,
        });
      } else if (options.format === 'webp') {
        processedImage = image.webp({
          quality: options.webpQuality,
        });
      } else {
        processedImage = image.jpeg({
          quality: options.jpegQuality,
          progressive: true,
          mozjpeg: true,
        });
      }

      const processedBuffer = await processedImage.toBuffer();

      return { processedBuffer, dimensions };
    } catch (error) {
      throw new ImageProcessingError(
        `Sharp processing failed: ${error instanceof Error ? error.message : String(error)}`,
        'Failed to process image'
      );
    }
  }

  /**
   * Fallback processing without Sharp library
   *
   * When Sharp is unavailable (e.g., ARM64 without prebuilt binaries),
   * this method provides basic functionality:
   * - Validates the buffer contains a valid image
   * - Extracts PNG dimensions from header if possible
   * - Passes through the original buffer without format conversion
   *
   * Note: Format conversion is not available in this mode.
   *
   * @param buffer - Raw image data buffer
   * @param _options - Processing options (format conversion not supported)
   * @returns Original buffer and extracted dimensions (if PNG)
   * @throws ImageProcessingError if buffer is not a valid image
   */
  private processWithoutSharp(
    buffer: Buffer,
    _options: ImageProcessorOptions
  ): { processedBuffer: Buffer; dimensions: ImageDimensions | null } {
    // Without Sharp, we can only pass through the original buffer
    // Try to extract dimensions from PNG header if it's a PNG
    const dimensions = this.extractPngDimensions(buffer);

    // Validate the buffer looks like an image
    if (!this.validateImageBuffer(buffer)) {
      throw new ImageProcessingError('Invalid image data', 'The clipboard data is not a valid image');
    }

    // Note: Without Sharp, we can't convert formats
    // The buffer is returned as-is
    return { processedBuffer: buffer, dimensions };
  }

  /**
   * Extract dimensions from PNG IHDR chunk
   *
   * Parses the PNG file format to extract width and height from
   * the IHDR (Image Header) chunk without using external libraries.
   *
   * PNG structure:
   * - Bytes 0-7: PNG signature
   * - Bytes 8-11: IHDR chunk length (always 13)
   * - Bytes 12-15: IHDR chunk type
   * - Bytes 16-19: Width (big-endian uint32)
   * - Bytes 20-23: Height (big-endian uint32)
   *
   * @param buffer - Image data buffer
   * @returns Image dimensions or null if not a valid PNG
   */
  private extractPngDimensions(buffer: Buffer): ImageDimensions | null {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (buffer.length < 24) {
      return null;
    }

    // Check PNG signature
    if (
      buffer[0] !== 0x89 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x4e ||
      buffer[3] !== 0x47
    ) {
      return null;
    }

    // IHDR chunk starts at byte 8
    // Chunk structure: length (4 bytes) + type (4 bytes) + data + CRC (4 bytes)
    // IHDR data: width (4 bytes) + height (4 bytes) + ...

    try {
      // Width is at offset 16, height at offset 20
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);

      // Sanity check
      if (width > 0 && width < 100000 && height > 0 && height < 100000) {
        return { width, height };
      }
    } catch {
      // Failed to read dimensions
    }

    return null;
  }

  /**
   * Validate that buffer contains a recognized image format
   *
   * Checks the magic bytes (file signature) to identify supported formats:
   * - PNG: 89 50 4E 47 (‰PNG)
   * - JPEG: FF D8 FF
   * - BMP: 42 4D (BM)
   * - GIF: 47 49 46 38 (GIF8)
   *
   * @param buffer - Data buffer to validate
   * @returns True if buffer starts with a recognized image signature
   */
  private validateImageBuffer(buffer: Buffer): boolean {
    if (buffer.length < 8) {
      return false;
    }

    // Check for PNG signature
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return true;
    }

    // Check for JPEG signature
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return true;
    }

    // Check for BMP signature
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return true;
    }

    // Check for GIF signature
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if Sharp is available
   */
  async isSharpAvailable(): Promise<boolean> {
    const sharp = await loadSharp();
    return sharp !== null;
  }

  /**
   * Get the path generator
   */
  getPathGenerator(): PathGenerator {
    return this.pathGenerator;
  }

  /**
   * Get the file writer
   */
  getFileWriter(): FileWriter {
    return this.fileWriter;
  }
}
