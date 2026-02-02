import { describe, it, expect } from 'vitest';
import {
  validateSaveDirectory,
  validateFileNamePattern,
  validateSequenceDigits,
  validateJpegQuality,
  validateWebpQuality,
  validateMaxFileSizeMB,
  validateAltLiteral,
  validateResizeMode,
  validateImageDimension,
  validateResizePreset,
  validateConfiguration,
  sanitizeConfiguration,
  getConfigurationWarnings,
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

    it('should skip validation for undefined fields', () => {
      const result = validateConfiguration({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('sanitizeConfiguration', () => {
    describe('saveDirectory sanitization', () => {
      it('should convert backslashes to forward slashes', () => {
        const result = sanitizeConfiguration({
          saveDirectory: 'path\\to\\images',
        });
        expect(result.saveDirectory).toBe('path/to/images');
      });

      it('should normalize consecutive slashes', () => {
        const result = sanitizeConfiguration({
          saveDirectory: 'path//to///images',
        });
        expect(result.saveDirectory).toBe('path/to/images');
      });

      it('should remove leading and trailing slashes', () => {
        const result = sanitizeConfiguration({
          saveDirectory: '/path/to/images/',
        });
        expect(result.saveDirectory).toBe('path/to/images');
      });

      it('should trim whitespace', () => {
        const result = sanitizeConfiguration({
          saveDirectory: '  images  ',
        });
        expect(result.saveDirectory).toBe('images');
      });

      it('should handle complex path normalization', () => {
        const result = sanitizeConfiguration({
          saveDirectory: '\\\\path///to\\\\images//',
        });
        expect(result.saveDirectory).toBe('path/to/images');
      });

      it('should not modify empty saveDirectory', () => {
        const result = sanitizeConfiguration({
          saveDirectory: '',
        });
        expect(result.saveDirectory).toBe('');
      });
    });

    describe('fileName.pattern sanitization', () => {
      it('should trim whitespace from pattern', () => {
        const result = sanitizeConfiguration({
          fileName: { pattern: '  image_${seq3}  ' },
        });
        expect(result.fileName?.pattern).toBe('image_${seq3}');
      });

      it('should not modify empty pattern', () => {
        const result = sanitizeConfiguration({
          fileName: { pattern: '' },
        });
        expect(result.fileName?.pattern).toBe('');
      });
    });

    describe('numeric value clamping', () => {
      it('should clamp sequenceDigits to minimum', () => {
        const result = sanitizeConfiguration({
          fileName: { sequenceDigits: 0 },
        });
        expect(result.fileName?.sequenceDigits).toBe(1);
      });

      it('should clamp sequenceDigits to maximum', () => {
        const result = sanitizeConfiguration({
          fileName: { sequenceDigits: 10 },
        });
        expect(result.fileName?.sequenceDigits).toBe(6);
      });

      it('should clamp jpegQuality to minimum', () => {
        const result = sanitizeConfiguration({
          output: { jpegQuality: 0 },
        });
        expect(result.output?.jpegQuality).toBe(1);
      });

      it('should clamp jpegQuality to maximum', () => {
        const result = sanitizeConfiguration({
          output: { jpegQuality: 150 },
        });
        expect(result.output?.jpegQuality).toBe(100);
      });

      it('should clamp maxFileSizeMB to minimum', () => {
        const result = sanitizeConfiguration({
          limits: { maxFileSizeMB: 0 },
        });
        expect(result.limits?.maxFileSizeMB).toBe(1);
      });

      it('should clamp maxFileSizeMB to maximum', () => {
        const result = sanitizeConfiguration({
          limits: { maxFileSizeMB: 200 },
        });
        expect(result.limits?.maxFileSizeMB).toBe(100);
      });

      it('should keep values within valid range unchanged', () => {
        const result = sanitizeConfiguration({
          fileName: { sequenceDigits: 3 },
          output: { jpegQuality: 80 },
          limits: { maxFileSizeMB: 50 },
        });
        expect(result.fileName?.sequenceDigits).toBe(3);
        expect(result.output?.jpegQuality).toBe(80);
        expect(result.limits?.maxFileSizeMB).toBe(50);
      });
    });

    describe('complete configuration sanitization', () => {
      it('should sanitize all fields at once', () => {
        const result = sanitizeConfiguration({
          saveDirectory: '\\path\\to\\images\\',
          fileName: { pattern: '  image_${seq3}  ', sequenceDigits: 10 },
          output: { jpegQuality: 150 },
          limits: { maxFileSizeMB: 200 },
        });

        expect(result.saveDirectory).toBe('path/to/images');
        expect(result.fileName?.pattern).toBe('image_${seq3}');
        expect(result.fileName?.sequenceDigits).toBe(6);
        expect(result.output?.jpegQuality).toBe(100);
        expect(result.limits?.maxFileSizeMB).toBe(100);
      });
    });
  });

  describe('additional edge cases', () => {
    describe('validateSaveDirectory edge cases', () => {
      it('should reject whitespace-only paths', () => {
        const result = validateSaveDirectory('   ');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Save directory cannot be empty');
      });

      it('should reject paths with null bytes', () => {
        const result = validateSaveDirectory('path\x00/images');
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('null'))).toBe(true);
      });

      it('should reject Windows absolute paths', () => {
        const result = validateSaveDirectory('C:\\path\\to\\images');
        expect(result.valid).toBe(false);
      });
    });

    describe('validateFileNamePattern edge cases', () => {
      it('should reject patterns with dangerous shell characters', () => {
        const result = validateFileNamePattern('image;rm -rf;_${seq3}');
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('dangerous'))).toBe(true);
      });

      it('should reject multiple invalid tokens', () => {
        const result = validateFileNamePattern('${invalid1}_${invalid2}');
        expect(result.valid).toBe(false);
        expect(result.errors.filter((e) => e.includes('Invalid token')).length).toBe(2);
      });

      it('should reject sequence with zero digits', () => {
        const result = validateFileNamePattern('${seq0}');
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('digit count'))).toBe(true);
      });

      it('should accept all valid time tokens', () => {
        const tokens = ['${yyyy}', '${MM}', '${dd}', '${HH}', '${mm}', '${ss}'];
        for (const token of tokens) {
          const result = validateFileNamePattern(`image_${token}`);
          expect(result.valid).toBe(true);
        }
      });
    });

    describe('validateSequenceDigits edge cases', () => {
      it('should reject non-integer values', () => {
        const result = validateSequenceDigits(3.5);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('integer'))).toBe(true);
      });

      it('should reject NaN', () => {
        const result = validateSequenceDigits(NaN);
        expect(result.valid).toBe(false);
      });
    });

    describe('validateJpegQuality edge cases', () => {
      it('should reject non-integer values', () => {
        const result = validateJpegQuality(80.5);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('integer'))).toBe(true);
      });

      it('should reject NaN', () => {
        const result = validateJpegQuality(NaN);
        expect(result.valid).toBe(false);
      });
    });

    describe('validateMaxFileSizeMB edge cases', () => {
      it('should reject non-integer values', () => {
        const result = validateMaxFileSizeMB(10.5);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('integer'))).toBe(true);
      });

      it('should reject NaN', () => {
        const result = validateMaxFileSizeMB(NaN);
        expect(result.valid).toBe(false);
      });
    });

    describe('validateAltLiteral edge cases', () => {
      it('should reject non-string values', () => {
        // Cast to bypass TypeScript for testing runtime behavior
        const result = validateAltLiteral(123 as unknown as string);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('string'))).toBe(true);
      });

      it('should accept empty string', () => {
        const result = validateAltLiteral('');
        expect(result.valid).toBe(true);
      });

      it('should reject greater-than sign', () => {
        const result = validateAltLiteral('value > 5');
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('validateResizeMode', () => {
    it('should accept "off"', () => {
      const result = validateResizeMode('off');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept "fit"', () => {
      const result = validateResizeMode('fit');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid mode', () => {
      const result = validateResizeMode('invalid');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('off') && e.includes('fit'))).toBe(true);
    });

    it('should reject empty string', () => {
      const result = validateResizeMode('');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateImageDimension', () => {
    it('should accept null value', () => {
      const result = validateImageDimension(null, 'maxWidth');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid positive integer', () => {
      const result = validateImageDimension(1200, 'maxWidth');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept minimum value (1)', () => {
      const result = validateImageDimension(1, 'maxWidth');
      expect(result.valid).toBe(true);
    });

    it('should accept maximum value (16384)', () => {
      const result = validateImageDimension(16384, 'maxHeight');
      expect(result.valid).toBe(true);
    });

    it('should reject zero', () => {
      const result = validateImageDimension(0, 'maxWidth');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('between'))).toBe(true);
    });

    it('should reject negative value', () => {
      const result = validateImageDimension(-100, 'maxWidth');
      expect(result.valid).toBe(false);
    });

    it('should reject value exceeding maximum', () => {
      const result = validateImageDimension(20000, 'maxWidth');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('16384'))).toBe(true);
    });

    it('should reject non-integer float', () => {
      const result = validateImageDimension(100.5, 'maxWidth');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('integer'))).toBe(true);
    });

    it('should include field name in error message', () => {
      const result = validateImageDimension(-1, 'Maximum width');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Maximum width'))).toBe(true);
    });
  });

  describe('validateResizePreset', () => {
    it('should accept null', () => {
      const result = validateResizePreset(null);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept "ai-optimized"', () => {
      const result = validateResizePreset('ai-optimized');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid preset', () => {
      const result = validateResizePreset('invalid-preset');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('ai-optimized'))).toBe(true);
    });

    it('should reject empty string', () => {
      const result = validateResizePreset('');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateConfiguration with resize options', () => {
    it('should validate resize.mode', () => {
      const result = validateConfiguration({
        resize: {
          mode: 'invalid' as 'off' | 'fit',
          maxWidth: null,
          maxHeight: null,
          preset: null,
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('mode'))).toBe(true);
    });

    it('should validate resize.maxWidth', () => {
      const result = validateConfiguration({
        resize: {
          mode: 'fit',
          maxWidth: -100,
          maxHeight: null,
          preset: null,
        },
      });
      expect(result.valid).toBe(false);
    });

    it('should validate resize.maxHeight', () => {
      const result = validateConfiguration({
        resize: {
          mode: 'fit',
          maxWidth: null,
          maxHeight: 20000,
          preset: null,
        },
      });
      expect(result.valid).toBe(false);
    });

    it('should validate resize.preset', () => {
      const result = validateConfiguration({
        resize: {
          mode: 'fit',
          maxWidth: null,
          maxHeight: null,
          preset: 'invalid' as 'ai-optimized' | null,
        },
      });
      expect(result.valid).toBe(false);
    });

    it('should accept valid resize configuration', () => {
      const result = validateConfiguration({
        resize: {
          mode: 'fit',
          maxWidth: 1200,
          maxHeight: 1200,
          preset: 'ai-optimized',
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('sanitizeConfiguration with resize options', () => {
    it('should clamp maxWidth to valid range', () => {
      const result = sanitizeConfiguration({
        resize: {
          mode: 'fit',
          maxWidth: 20000,
          maxHeight: null,
          preset: null,
        },
      });
      expect(result.resize?.maxWidth).toBe(16384);
    });

    it('should clamp maxHeight to valid range', () => {
      const result = sanitizeConfiguration({
        resize: {
          mode: 'fit',
          maxWidth: null,
          maxHeight: 0,
          preset: null,
        },
      });
      expect(result.resize?.maxHeight).toBe(1);
    });

    it('should not modify null values', () => {
      const result = sanitizeConfiguration({
        resize: {
          mode: 'fit',
          maxWidth: null,
          maxHeight: null,
          preset: null,
        },
      });
      expect(result.resize?.maxWidth).toBeNull();
      expect(result.resize?.maxHeight).toBeNull();
    });
  });

  describe('validateWebpQuality', () => {
    it('should accept valid quality values', () => {
      expect(validateWebpQuality(1).valid).toBe(true);
      expect(validateWebpQuality(50).valid).toBe(true);
      expect(validateWebpQuality(80).valid).toBe(true);
      expect(validateWebpQuality(100).valid).toBe(true);
    });

    it('should reject quality below minimum', () => {
      const result = validateWebpQuality(0);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('WebP quality'))).toBe(true);
    });

    it('should reject quality above maximum', () => {
      const result = validateWebpQuality(101);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('WebP quality'))).toBe(true);
    });

    it('should reject negative values', () => {
      const result = validateWebpQuality(-10);
      expect(result.valid).toBe(false);
    });

    it('should reject non-integer values', () => {
      const result = validateWebpQuality(80.5);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('integer'))).toBe(true);
    });
  });

  describe('getConfigurationWarnings', () => {
    it('should warn when resize dimensions are set but mode is off', () => {
      const warnings = getConfigurationWarnings({
        resize: {
          mode: 'off',
          maxWidth: 1200,
          maxHeight: 1200,
          preset: null,
        },
      });
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('ignored');
      expect(warnings[0]).toContain('off');
    });

    it('should warn when preset overrides manual dimensions', () => {
      const warnings = getConfigurationWarnings({
        resize: {
          mode: 'fit',
          maxWidth: 800,
          maxHeight: 600,
          preset: 'ai-optimized',
        },
      });
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('overrides');
      expect(warnings[0]).toContain('ai-optimized');
    });

    it('should not warn when mode is fit with dimensions and no preset', () => {
      const warnings = getConfigurationWarnings({
        resize: {
          mode: 'fit',
          maxWidth: 800,
          maxHeight: 600,
          preset: null,
        },
      });
      expect(warnings.length).toBe(0);
    });

    it('should not warn when mode is off with null dimensions', () => {
      const warnings = getConfigurationWarnings({
        resize: {
          mode: 'off',
          maxWidth: null,
          maxHeight: null,
          preset: null,
        },
      });
      expect(warnings.length).toBe(0);
    });

    it('should not warn when preset is set but no manual dimensions', () => {
      const warnings = getConfigurationWarnings({
        resize: {
          mode: 'fit',
          maxWidth: null,
          maxHeight: null,
          preset: 'ai-optimized',
        },
      });
      expect(warnings.length).toBe(0);
    });
  });
});
