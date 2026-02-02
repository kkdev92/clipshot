/**
 * Image processor using Sharp
 * Handles format conversion, optimization, and metadata extraction
 */

import type { ImageFormat, ProcessedImage, ImageDimensions, ResizeMode } from '../core/types';
import { ImageProcessingError, FileSizeLimitError } from '../core/errors';
import { LIMITS } from '../core/constants';
import { PathGenerator } from './path-generator';
import { FileWriter } from './file-writer';

// Sharp is dynamically imported to handle cases where it's not available

/**
 * Output information returned by Sharp's toBuffer({ resolveWithObject: true })
 */
type OutputInfo = {
  format: string;
  width: number;
  height: number;
  channels: number;
  size: number;
};

/**
 * Sharp instance type for processing pipeline
 */
type SharpInstance = {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  resize(width?: number | null, height?: number | null, options?: {
    fit?: 'contain' | 'cover' | 'fill' | 'inside' | 'outside';
    withoutEnlargement?: boolean;
  }): SharpInstance;
  png(options?: { compressionLevel?: number; progressive?: boolean }): SharpInstance;
  jpeg(options?: { quality?: number; progressive?: boolean; mozjpeg?: boolean }): SharpInstance;
  webp(options?: { quality?: number }): SharpInstance;
  toBuffer(): Promise<Buffer>;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: OutputInfo }>;
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
  /** Resize mode */
  resizeMode: ResizeMode;
  /** Maximum width in pixels (null = no limit) */
  maxWidth: number | null;
  /** Maximum height in pixels (null = no limit) */
  maxHeight: number | null;
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
   * Uses an efficient single-pipeline approach:
   * 1. Create Sharp instance with input buffer
   * 2. Apply resize if mode='fit' and dimensions specified
   * 3. Apply format conversion with quality settings
   * 4. Output buffer with metadata in one operation using toBuffer({ resolveWithObject: true })
   *
   * ## Resize Behavior
   * - mode='off': No resize applied, original dimensions preserved
   * - mode='fit': Fits image within maxWidth/maxHeight bounds
   *   - Maintains aspect ratio using 'inside' fit
   *   - Does NOT upscale images smaller than bounds (withoutEnlargement: true)
   *   - If only maxWidth specified: constrains width, height scales proportionally
   *   - If only maxHeight specified: constrains height, width scales proportionally
   *   - If both specified: constrains to fit within both bounds
   *
   * ## Why 'inside' fit mode?
   * - 'inside': Image fits entirely within bounds, preserving aspect ratio (chosen)
   * - 'contain': Same as 'inside' but may add padding (not wanted)
   * - 'cover': Fills bounds but may crop (not wanted for screenshots)
   * - 'fill': Stretches to fit, distorts aspect ratio (not wanted)
   *
   * ## Dimension Rounding
   * Final dimensions may vary ±1 pixel due to aspect ratio calculation rounding.
   * Sharp handles this internally to maintain integer pixel dimensions.
   *
   * @param sharp - Sharp module reference
   * @param buffer - Raw image data buffer
   * @param options - Processing options including format, quality, and resize settings
   * @returns Processed buffer and FINAL dimensions (post-resize, post-format-conversion)
   * @throws ImageProcessingError with context about processing failure
   */
  private async processWithSharp(
    sharp: SharpModule,
    buffer: Buffer,
    options: ImageProcessorOptions
  ): Promise<{ processedBuffer: Buffer; dimensions: ImageDimensions | null }> {
    try {
      // Create single Sharp pipeline for efficient processing
      let pipeline = sharp.default(buffer);

      // Apply resize if mode is 'fit' and dimensions are specified
      if (options.resizeMode === 'fit' && (options.maxWidth !== null || options.maxHeight !== null)) {
        pipeline = pipeline.resize(
          options.maxWidth ?? undefined,
          options.maxHeight ?? undefined,
          {
            fit: 'inside',           // Maintain aspect ratio, fit within bounds
            withoutEnlargement: true // Don't upscale small images
          }
        );
      }

      // Apply format conversion
      pipeline = this.applyFormatConversion(pipeline, options);

      // Get processed buffer with output info (includes final dimensions)
      // This is more efficient than calling metadata() separately
      const { data: processedBuffer, info } = await pipeline.toBuffer({ resolveWithObject: true });

      // Extract final dimensions from output info
      const dimensions: ImageDimensions | null =
        info.width > 0 && info.height > 0
          ? { width: info.width, height: info.height }
          : null;

      return { processedBuffer, dimensions };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new ImageProcessingError(
        `Sharp processing failed: ${errorMessage} (format: ${options.format}, resize: ${options.resizeMode})`,
        'Failed to process image'
      );
    }
  }

  /**
   * Apply format conversion to Sharp pipeline
   *
   * @param pipeline - Sharp pipeline instance
   * @param options - Processing options with format and quality settings
   * @returns Sharp pipeline with format conversion applied
   */
  private applyFormatConversion(
    pipeline: SharpInstance,
    options: ImageProcessorOptions
  ): SharpInstance {
    switch (options.format) {
      case 'png':
        return pipeline.png({
          compressionLevel: 6,
          progressive: false,
        });
      case 'webp':
        return pipeline.webp({
          quality: options.webpQuality,
        });
      case 'jpeg':
      default:
        return pipeline.jpeg({
          quality: options.jpegQuality,
          progressive: true,
          mozjpeg: true,
        });
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

      // Sanity check: dimensions must be positive and within supported bounds
      // Uses MAX_IMAGE_DIMENSION constant for consistency with validation limits
      if (width > 0 && width <= LIMITS.MAX_IMAGE_DIMENSION && height > 0 && height <= LIMITS.MAX_IMAGE_DIMENSION) {
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
