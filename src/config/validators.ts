/**
 * Configuration validation utilities
 * Validates user settings to prevent security issues
 */

import type { ValidationResult, ExtensionConfig } from '../core/types';
import {
  LIMITS,
  VALID_PATTERN_TOKENS,
  PATTERN_TOKENS,
  DANGEROUS_SHELL_CHARS,
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
 * Validate the entire extension configuration
 *
 * @param config - The configuration object
 * @returns Validation result with all errors
 */
export function validateConfiguration(config: Partial<ExtensionConfig>): ValidationResult {
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
export function sanitizeConfiguration(config: Partial<ExtensionConfig>): Partial<ExtensionConfig> {
  const sanitized: Partial<ExtensionConfig> = { ...config };

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

  return sanitized;
}
