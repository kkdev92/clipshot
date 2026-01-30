import { describe, it, expect } from 'vitest';
import {
  validateSaveDirectory,
  validateFileNamePattern,
  validateSequenceDigits,
  validateJpegQuality,
  validateMaxFileSizeMB,
  validateAltLiteral,
  validateConfiguration,
} from '../../src/config/validators';

describe('validators', () => {
  describe('validateSaveDirectory', () => {
    it('should accept valid relative paths', () => {
      expect(validateSaveDirectory('.clipshot').valid).toBe(true);
      expect(validateSaveDirectory('images').valid).toBe(true);
      expect(validateSaveDirectory('path/to/images').valid).toBe(true);
    });

    it('should reject empty paths', () => {
      const result = validateSaveDirectory('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Save directory cannot be empty');
    });

    it('should reject absolute paths', () => {
      const result = validateSaveDirectory('/absolute/path');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('relative'))).toBe(true);
    });

    it('should reject parent traversal', () => {
      const result = validateSaveDirectory('../outside');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('..'))).toBe(true);
    });

    it('should reject dangerous characters', () => {
      const result = validateSaveDirectory('path;rm -rf');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid characters'))).toBe(true);
    });
  });

  describe('validateFileNamePattern', () => {
    it('should accept valid patterns', () => {
      expect(validateFileNamePattern('image_${yyyy}${MM}${dd}').valid).toBe(true);
      expect(validateFileNamePattern('${HH}${mm}${ss}_${seq3}').valid).toBe(true);
      expect(validateFileNamePattern('screenshot_${yyyy}-${MM}-${dd}').valid).toBe(true);
    });

    it('should reject empty patterns', () => {
      const result = validateFileNamePattern('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('File name pattern cannot be empty');
    });

    it('should reject invalid tokens', () => {
      const result = validateFileNamePattern('${invalid}');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid token'))).toBe(true);
    });

    it('should validate sequence digit range', () => {
      expect(validateFileNamePattern('image_${seq0}').valid).toBe(false);
      expect(validateFileNamePattern('image_${seq7}').valid).toBe(false);
      expect(validateFileNamePattern('image_${seq3}').valid).toBe(true);
    });

    it('should warn about patterns without uniqueness tokens', () => {
      const result = validateFileNamePattern('static_name');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('timestamp or sequence'))).toBe(true);
    });
  });

  describe('validateSequenceDigits', () => {
    it('should accept valid digit counts', () => {
      expect(validateSequenceDigits(1).valid).toBe(true);
      expect(validateSequenceDigits(3).valid).toBe(true);
      expect(validateSequenceDigits(6).valid).toBe(true);
    });

    it('should reject out-of-range values', () => {
      expect(validateSequenceDigits(0).valid).toBe(false);
      expect(validateSequenceDigits(7).valid).toBe(false);
      expect(validateSequenceDigits(-1).valid).toBe(false);
    });
  });

  describe('validateJpegQuality', () => {
    it('should accept valid quality values', () => {
      expect(validateJpegQuality(1).valid).toBe(true);
      expect(validateJpegQuality(50).valid).toBe(true);
      expect(validateJpegQuality(100).valid).toBe(true);
    });

    it('should reject out-of-range values', () => {
      expect(validateJpegQuality(0).valid).toBe(false);
      expect(validateJpegQuality(101).valid).toBe(false);
      expect(validateJpegQuality(-10).valid).toBe(false);
    });
  });

  describe('validateMaxFileSizeMB', () => {
    it('should accept valid file sizes', () => {
      expect(validateMaxFileSizeMB(1).valid).toBe(true);
      expect(validateMaxFileSizeMB(10).valid).toBe(true);
      expect(validateMaxFileSizeMB(100).valid).toBe(true);
    });

    it('should reject out-of-range values', () => {
      expect(validateMaxFileSizeMB(0).valid).toBe(false);
      expect(validateMaxFileSizeMB(101).valid).toBe(false);
    });
  });

  describe('validateAltLiteral', () => {
    it('should accept safe alt text', () => {
      expect(validateAltLiteral('image').valid).toBe(true);
      expect(validateAltLiteral('Screenshot 2024').valid).toBe(true);
    });

    it('should warn about HTML-breaking characters', () => {
      expect(validateAltLiteral('<script>').valid).toBe(false);
      expect(validateAltLiteral('text with "quotes"').valid).toBe(false);
    });
  });

  describe('validateConfiguration', () => {
    it('should validate complete configuration', () => {
      const config = {
        saveDirectory: '.clipshot',
        fileName: {
          pattern: 'image_${yyyy}${MM}${dd}_${seq3}',
          sequenceDigits: 3,
        },
        output: {
          jpegQuality: 80,
        },
        limits: {
          maxFileSizeMB: 10,
        },
        insert: {
          altLiteral: 'image',
        },
      };

      const result = validateConfiguration(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect all validation errors', () => {
      const config = {
        saveDirectory: '../outside',
        fileName: {
          pattern: 'static',
          sequenceDigits: 10,
        },
        output: {
          jpegQuality: 200,
        },
      };

      const result = validateConfiguration(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
});
