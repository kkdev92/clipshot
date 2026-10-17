import { describe, it, expect, beforeEach } from 'vitest';
import {
  PathGenerator,
  clearSequenceCache,
  withNameSuffix,
} from '../../src/image/path-generator';

describe('PathGenerator', () => {
  let generator: PathGenerator;

  beforeEach(() => {
    generator = new PathGenerator('/workspace');
    clearSequenceCache();
  });

  describe('generateFileName', () => {
    it('should replace date tokens', () => {
      const date = new Date(2024, 0, 15, 14, 30, 45); // Jan 15, 2024, 14:30:45
      const result = generator.generateFileName(
        'image_${yyyy}${MM}${dd}',
        'png',
        date
      );

      expect(result).toBe('image_20240115.png');
    });

    it('should replace time tokens', () => {
      const date = new Date(2024, 0, 15, 14, 30, 45);
      const result = generator.generateFileName(
        'image_${HH}${mm}${ss}',
        'png',
        date
      );

      expect(result).toBe('image_143045.png');
    });

    it('should replace sequence tokens', () => {
      const date = new Date(2024, 0, 15, 14, 30, 45);

      const result1 = generator.generateFileName('image_${seq3}', 'png', date);
      const result2 = generator.generateFileName('image_${seq3}', 'png', date);
      const result3 = generator.generateFileName('image_${seq3}', 'png', date);

      expect(result1).toBe('image_001.png');
      expect(result2).toBe('image_002.png');
      expect(result3).toBe('image_003.png');
    });

    it('should handle different sequence digit counts', () => {
      const date = new Date(2024, 0, 15, 14, 30, 45);

      expect(generator.generateFileName('img_${seq1}', 'png', date)).toBe('img_1.png');
      clearSequenceCache();
      expect(generator.generateFileName('img_${seq5}', 'png', date)).toBe('img_00001.png');
    });

    it('should take the width of ${seq3} from clipshot.fileName.sequenceDigits', () => {
      const date = new Date(2024, 0, 15, 14, 30, 45);

      expect(generator.generateFileName('img_${seq3}', 'png', date, 5)).toBe('img_00001.png');
      clearSequenceCache();
      expect(generator.generateFileName('img_${seq3}', 'png', date, 1)).toBe('img_1.png');
    });

    it('should keep the width a token names other than 3, whatever the setting', () => {
      const date = new Date(2024, 0, 15, 14, 30, 45);

      expect(generator.generateFileName('img_${seq5}', 'png', date, 2)).toBe('img_00001.png');
    });

    it('should add extension correctly', () => {
      const date = new Date(2024, 0, 15);
      expect(generator.generateFileName('image', 'png', date)).toBe('image.png');
      expect(generator.generateFileName('image', '.jpg', date)).toBe('image.jpg');
    });

    it('should sanitize dangerous characters', () => {
      const date = new Date(2024, 0, 15);
      const result = generator.generateFileName('image<>:test', 'png', date);
      // Should not contain dangerous characters
      expect(result).not.toMatch(/[<>:]/);
    });
  });

  /**
   * The names one save tries when the name before is taken
   */
  describe('generateFileNames', () => {
    const date = new Date(2024, 0, 15, 14, 30, 45);

    it('should start with the name generateFileName gives', () => {
      const names = generator.generateFileNames('image_${seq3}', 'png', date);
      clearSequenceCache();

      expect(names(0)).toBe(generator.generateFileName('image_${seq3}', 'png', date));
    });

    it('should move the sequence on when the pattern has one', () => {
      const names = generator.generateFileNames('image_${seq3}', 'png', date);

      expect([names(0), names(1), names(2)]).toEqual([
        'image_001.png',
        'image_002.png',
        'image_003.png',
      ]);
    });

    it('should start from the number the sequence cache gives', () => {
      generator.generateFileName('image_${seq3}', 'png', date);
      const names = generator.generateFileNames('image_${seq3}', 'png', date);

      expect([names(0), names(1)]).toEqual(['image_002.png', 'image_003.png']);
    });

    it('should add _1, _2 before the extension when the pattern has no sequence', () => {
      const names = generator.generateFileNames('screenshot_${yyyy}${MM}${dd}', 'png', date);

      expect([names(0), names(1), names(2)]).toEqual([
        'screenshot_20240115.png',
        'screenshot_20240115_1.png',
        'screenshot_20240115_2.png',
      ]);
    });

    it('should add a suffix when the length limit cuts the number off', () => {
      // 200 characters fill the limit, so every number gives the same name
      const names = generator.generateFileNames('a'.repeat(200) + '_${seq3}', 'png', date);

      expect(names(0)).toBe('a'.repeat(200) + '.png');
      expect(names(1)).toBe('a'.repeat(198) + '_1.png');
    });
  });

  describe('withNameSuffix', () => {
    it('should put the number before the extension', () => {
      expect(withNameSuffix('image.png', 1)).toBe('image_1.png');
      expect(withNameSuffix('image', 12)).toBe('image_12');
    });

    it('should shorten the name so the result stays within the limit', () => {
      const result = withNameSuffix('画'.repeat(66) + '.png', 1);

      // 66 kanji are 198 bytes, and "_1" needs 2 of the 200
      expect(result).toBe('画'.repeat(66) + '_1.png');
      expect(withNameSuffix('画'.repeat(66) + '.png', 10)).toBe('画'.repeat(65) + '_10.png');
    });
  });

  describe('generateSavePath', () => {
    it('should create full path', () => {
      const result = generator.generateSavePath('.claude-images', 'test.png');
      expect(result).toContain('.claude-images');
      expect(result).toContain('test.png');
    });

    it('should normalize path separators', () => {
      const result = generator.generateSavePath('path\\to\\dir', 'test.png');
      // Path should be normalized
      expect(result).toBeTruthy();
    });
  });

  describe('generateRelativePath', () => {
    it('should create relative path with ./ prefix', () => {
      const result = generator.generateRelativePath('/workspace/images/test.png');
      expect(result).toBe('./images/test.png');
    });

    it('should handle root level files', () => {
      const result = generator.generateRelativePath('/workspace/test.png');
      expect(result).toBe('./test.png');
    });
  });

  describe('sequence cache', () => {
    it('should reset sequence for different seconds', () => {
      const date1 = new Date(2024, 0, 15, 14, 30, 45);
      const date2 = new Date(2024, 0, 15, 14, 30, 46); // Different second

      const result1 = generator.generateFileName('img_${seq3}', 'png', date1);
      const result2 = generator.generateFileName('img_${seq3}', 'png', date2);

      expect(result1).toBe('img_001.png');
      expect(result2).toBe('img_001.png'); // Reset because different second
    });
  });
});
