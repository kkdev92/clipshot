/**
 * Configuration validation utilities
 * Validates user settings to prevent security issues
 */

import type { ValidationResult, ExtensionConfig, DeepPartial } from '../core/types';
import {
  LIMITS,
  VALID_PATTERN_TOKENS,
  PATTERN_TOKENS,
  DANGEROUS_SHELL_CHARS,
  VALID_RESIZE_MODES,
  RESIZE_PRESETS,
} from '../core/constants';
import { containsParentTraversal, isAbsolutePath } from '../security/path-validator';

/**
 * Validate the saveDirectory setting
 *
 * @param value - The directory path to validate
 * @returns Validation result
 */
export function validateSaveDirectory(value: string): ValidationResult {
  const errors: string[] = [];

  // Check for empty value
  if (!value || value.trim() === '') {
    errors.push('Save directory cannot be empty');
    return { valid: false, errors };
  }

  // Check for absolute path
  if (isAbsolutePath(value)) {
    errors.push('Save directory must be a relative path');
  }

  // Check for parent directory traversal
  if (containsParentTraversal(value)) {
    errors.push('Save directory cannot contain parent directory references (..)');
  }

  // Check for dangerous characters
  if (DANGEROUS_SHELL_CHARS.test(value)) {
    errors.push('Save directory contains invalid characters');
  }

  // Check for null bytes
  if (value.includes('\x00')) {
    errors.push('Save directory contains invalid null character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the fileName.pattern setting
 *
 * @param value - The file name pattern to validate
 * @returns Validation result
 */
export function validateFileNamePattern(value: string): ValidationResult {
  const errors: string[] = [];

  // Check for empty value
  if (!value || value.trim() === '') {
    errors.push('File name pattern cannot be empty');
    return { valid: false, errors };
  }

  // Extract all tokens from the pattern
  const tokenMatches = value.match(/\$\{[^}]+\}/g) || [];

  // Validate each token
  for (const token of tokenMatches) {
    // Check if it's a valid fixed token
    if (VALID_PATTERN_TOKENS.includes(token as typeof VALID_PATTERN_TOKENS[number])) {
      continue;
    }

    // Check if it's a valid sequence token
    if (PATTERN_TOKENS.SEQUENCE.test(token)) {
      // Extract the digit count
      const match = token.match(/\$\{seq(\d+)\}/);
      if (match !== null && match[1] !== undefined && match[1] !== '') {
        const digits = parseInt(match[1], 10);
        if (digits < LIMITS.MIN_SEQUENCE_DIGITS || digits > LIMITS.MAX_SEQUENCE_DIGITS) {
          errors.push(
            `Sequence digit count must be between ${LIMITS.MIN_SEQUENCE_DIGITS} and ${LIMITS.MAX_SEQUENCE_DIGITS}`
          );
        }
      }
      continue;
    }

    // Unknown token
    errors.push(`Invalid token in pattern: ${token}`);
  }

  // Check for dangerous characters outside of tokens
  const patternWithoutTokens = value.replace(/\$\{[^}]+\}/g, '');
  if (DANGEROUS_SHELL_CHARS.test(patternWithoutTokens)) {
    errors.push('File name pattern contains potentially dangerous characters');
  }

  // Check that pattern contains at least one time-based token (for uniqueness)
  const hasTimeToken = VALID_PATTERN_TOKENS.some((token) => value.includes(token));
  const hasSeqToken = PATTERN_TOKENS.SEQUENCE.test(value);
  if (!hasTimeToken && !hasSeqToken) {
    errors.push('File name pattern should contain at least one timestamp or sequence token');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the sequenceDigits setting
 *
 * @param value - The number of digits
 * @returns Validation result
 */
export function validateSequenceDigits(value: number): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push('Sequence digits must be an integer');
    return { valid: false, errors };
  }

  if (value < LIMITS.MIN_SEQUENCE_DIGITS || value > LIMITS.MAX_SEQUENCE_DIGITS) {
    errors.push(
      `Sequence digits must be between ${LIMITS.MIN_SEQUENCE_DIGITS} and ${LIMITS.MAX_SEQUENCE_DIGITS}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the jpegQuality setting
 *
 * @param value - The JPEG quality value
 * @returns Validation result
 */
export function validateJpegQuality(value: number): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push('JPEG quality must be an integer');
    return { valid: false, errors };
  }

  if (value < LIMITS.MIN_JPEG_QUALITY || value > LIMITS.MAX_JPEG_QUALITY) {
    errors.push(
      `JPEG quality must be between ${LIMITS.MIN_JPEG_QUALITY} and ${LIMITS.MAX_JPEG_QUALITY}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the webpQuality setting
 *
 * @param value - The WebP quality value
 * @returns Validation result
 */
export function validateWebpQuality(value: number): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push('WebP quality must be an integer');
    return { valid: false, errors };
  }

  if (value < LIMITS.MIN_WEBP_QUALITY || value > LIMITS.MAX_WEBP_QUALITY) {
    errors.push(
      `WebP quality must be between ${LIMITS.MIN_WEBP_QUALITY} and ${LIMITS.MAX_WEBP_QUALITY}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the maxFileSizeMB setting
 *
 * @param value - The maximum file size in MB
 * @returns Validation result
 */
export function validateMaxFileSizeMB(value: number): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push('Maximum file size must be an integer');
    return { valid: false, errors };
  }

  if (value < LIMITS.MIN_FILE_SIZE_MB || value > LIMITS.MAX_FILE_SIZE_MB) {
    errors.push(
      `Maximum file size must be between ${LIMITS.MIN_FILE_SIZE_MB} and ${LIMITS.MAX_FILE_SIZE_MB} MB`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the alt literal text
 *
 * @param value - The alt text
 * @returns Validation result
 */
export function validateAltLiteral(value: string): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== 'string') {
    errors.push('Alt text must be a string');
    return { valid: false, errors };
  }

  // Check for dangerous characters that could break HTML/Markdown
  if (/<|>|"/.test(value)) {
    errors.push('Alt text contains characters that may break formatting');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate resize mode
 *
 * @param value - The resize mode value
 * @returns Validation result
 */
export function validateResizeMode(value: string): ValidationResult {
  const errors: string[] = [];

  // Use VALID_RESIZE_MODES constant for type-safe validation
  if (!VALID_RESIZE_MODES.includes(value as typeof VALID_RESIZE_MODES[number])) {
    errors.push(`Resize mode must be one of: ${VALID_RESIZE_MODES.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate image dimension (maxWidth/maxHeight)
 *
 * @param value - The dimension value (number or null)
 * @param fieldName - Name of the field for error messages
 * @returns Validation result
 */
export function validateImageDimension(
  value: number | null,
  fieldName: string
): ValidationResult {
  const errors: string[] = [];

  if (value === null) {
    return { valid: true, errors: [] };
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push(`${fieldName} must be an integer or null`);
    return { valid: false, errors };
  }

  if (value < LIMITS.MIN_IMAGE_DIMENSION || value > LIMITS.MAX_IMAGE_DIMENSION) {
    errors.push(
      `${fieldName} must be between ${LIMITS.MIN_IMAGE_DIMENSION} and ${LIMITS.MAX_IMAGE_DIMENSION}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate resize preset
 *
 * @param value - The preset value (string or null)
 * @returns Validation result
 */
export function validateResizePreset(value: string | null): ValidationResult {
  const errors: string[] = [];

  if (value === null) {
    return { valid: true, errors: [] };
  }

  // Use RESIZE_PRESETS keys as source of truth for valid presets
  const validPresets = Object.keys(RESIZE_PRESETS);
  if (!validPresets.includes(value)) {
    errors.push(`Resize preset must be one of: ${validPresets.join(', ')} or null`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the entire extension configuration
 *
 * @param config - The configuration object
 * @returns Validation result with all errors
 */
export function validateConfiguration(config: DeepPartial<ExtensionConfig>): ValidationResult {
  const allErrors: string[] = [];

  // Validate saveDirectory
  if (config.saveDirectory !== undefined) {
    const result = validateSaveDirectory(config.saveDirectory);
    allErrors.push(...result.errors);
  }

  // Validate fileName.pattern
  if (config.fileName?.pattern !== undefined) {
    const result = validateFileNamePattern(config.fileName.pattern);
    allErrors.push(...result.errors);
  }

  // Validate fileName.sequenceDigits
  if (config.fileName?.sequenceDigits !== undefined) {
    const result = validateSequenceDigits(config.fileName.sequenceDigits);
    allErrors.push(...result.errors);
  }

  // Validate output.jpegQuality
  if (config.output?.jpegQuality !== undefined) {
    const result = validateJpegQuality(config.output.jpegQuality);
    allErrors.push(...result.errors);
  }

  // Validate output.webpQuality
  if (config.output?.webpQuality !== undefined) {
    const result = validateWebpQuality(config.output.webpQuality);
    allErrors.push(...result.errors);
  }

  // Validate limits.maxFileSizeMB
  if (config.limits?.maxFileSizeMB !== undefined) {
    const result = validateMaxFileSizeMB(config.limits.maxFileSizeMB);
    allErrors.push(...result.errors);
  }

  // Validate insert.altLiteral
  if (config.insert?.altLiteral !== undefined) {
    const result = validateAltLiteral(config.insert.altLiteral);
    allErrors.push(...result.errors);
  }

  // Validate resize.mode
  if (config.resize?.mode !== undefined) {
    const result = validateResizeMode(config.resize.mode);
    allErrors.push(...result.errors);
  }

  // Validate resize.maxWidth
  if (config.resize?.maxWidth !== undefined) {
    const result = validateImageDimension(config.resize.maxWidth, 'Maximum width');
    allErrors.push(...result.errors);
  }

  // Validate resize.maxHeight
  if (config.resize?.maxHeight !== undefined) {
    const result = validateImageDimension(config.resize.maxHeight, 'Maximum height');
    allErrors.push(...result.errors);
  }

  // Validate resize.preset
  if (config.resize?.preset !== undefined) {
    const result = validateResizePreset(config.resize.preset);
    allErrors.push(...result.errors);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Sanitize and normalize configuration values
 * Returns a safe version of the configuration
 *
 * @param config - The raw configuration
 * @returns Sanitized configuration
 */
export function sanitizeConfiguration(config: DeepPartial<ExtensionConfig>): DeepPartial<ExtensionConfig> {
  const sanitized: DeepPartial<ExtensionConfig> = { ...config };

  // Sanitize saveDirectory - remove leading/trailing whitespace and normalize separators
  if (sanitized.saveDirectory !== undefined && sanitized.saveDirectory !== '') {
    sanitized.saveDirectory = sanitized.saveDirectory
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+|\/+$/g, '');
  }

  // Sanitize fileName.pattern - remove dangerous characters
  if (sanitized.fileName?.pattern !== undefined && sanitized.fileName.pattern !== '') {
    // Keep only safe characters (alphanumeric, underscore, hyphen, dot, spaces, and ${} tokens)
    sanitized.fileName = {
      ...sanitized.fileName,
      pattern: sanitized.fileName.pattern.trim(),
    };
  }

  // Clamp numeric values to valid ranges
  if (sanitized.fileName?.sequenceDigits !== undefined) {
    sanitized.fileName = {
      ...sanitized.fileName,
      sequenceDigits: Math.max(
        LIMITS.MIN_SEQUENCE_DIGITS,
        Math.min(LIMITS.MAX_SEQUENCE_DIGITS, sanitized.fileName.sequenceDigits)
      ),
    };
  }

  if (sanitized.output?.jpegQuality !== undefined) {
    sanitized.output = {
      ...sanitized.output,
      jpegQuality: Math.max(
        LIMITS.MIN_JPEG_QUALITY,
        Math.min(LIMITS.MAX_JPEG_QUALITY, sanitized.output.jpegQuality)
      ),
    };
  }

  if (sanitized.limits?.maxFileSizeMB !== undefined) {
    sanitized.limits = {
      ...sanitized.limits,
      maxFileSizeMB: Math.max(
        LIMITS.MIN_FILE_SIZE_MB,
        Math.min(LIMITS.MAX_FILE_SIZE_MB, sanitized.limits.maxFileSizeMB)
      ),
    };
  }

  // Clamp resize dimensions to valid ranges
  if (sanitized.resize?.maxWidth !== undefined && sanitized.resize.maxWidth !== null) {
    sanitized.resize = {
      ...sanitized.resize,
      maxWidth: Math.max(
        LIMITS.MIN_IMAGE_DIMENSION,
        Math.min(LIMITS.MAX_IMAGE_DIMENSION, sanitized.resize.maxWidth)
      ),
    };
  }

  if (sanitized.resize?.maxHeight !== undefined && sanitized.resize.maxHeight !== null) {
    sanitized.resize = {
      ...sanitized.resize,
      maxHeight: Math.max(
        LIMITS.MIN_IMAGE_DIMENSION,
        Math.min(LIMITS.MAX_IMAGE_DIMENSION, sanitized.resize.maxHeight)
      ),
    };
  }

  return sanitized;
}

/**
 * Get configuration warnings (non-blocking issues)
 *
 * Returns warnings for configuration combinations that are valid but may be
 * confusing or have unexpected behavior:
 * - Resize dimensions set when mode is 'off' (dimensions are ignored)
 * - Preset set when manual dimensions are also set (preset overrides)
 *
 * @param config - The configuration object
 * @returns Array of warning messages
 */
export function getConfigurationWarnings(config: DeepPartial<ExtensionConfig>): string[] {
  const warnings: string[] = [];

  // Warn if resize dimensions are set but mode is 'off'
  if (config.resize?.mode === 'off') {
    if (config.resize.maxWidth !== null || config.resize.maxHeight !== null) {
      warnings.push(
        'resize.maxWidth and resize.maxHeight are ignored when resize.mode is "off"'
      );
    }
  }

  // Warn if preset is set and will override manual dimensions
  if (config.resize?.preset !== null && config.resize?.preset !== undefined) {
    if (config.resize.maxWidth !== null || config.resize.maxHeight !== null) {
      // Check if preset exists in RESIZE_PRESETS
      const presetKey = config.resize.preset;
      if (presetKey in RESIZE_PRESETS) {
        const preset = RESIZE_PRESETS[presetKey as keyof typeof RESIZE_PRESETS];
        warnings.push(
          `Preset "${presetKey}" overrides resize.maxWidth/maxHeight ` +
          `(using ${preset.maxWidth}x${preset.maxHeight})`
        );
      }
    }
  }

  return warnings;
}
