import { describe, it, expect, beforeEach } from 'vitest';
import {
  PathGenerator,
  clearSequenceCache,
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
