import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  buildSafeRelativePath,
  isValidDirectoryName,
} from '../../src/security/path-validator';

describe('path-validator', () => {
  describe('normalizePath', () => {
    it('should normalize path separators', () => {
      expect(normalizePath('path\\to\\file')).toBe('path/to/file');
    });

    it('should resolve . segments', () => {
      expect(normalizePath('path/./to/file')).toBe('path/to/file');
    });

    it('should resolve .. segments', () => {
      expect(normalizePath('path/to/../file')).toBe('path/file');
    });

    it('should remove trailing slashes', () => {
      expect(normalizePath('path/to/dir/')).toBe('path/to/dir');
    });

    it('should preserve leading slash for absolute paths', () => {
      expect(normalizePath('/absolute/path')).toBe('/absolute/path');
    });
  });

  describe('buildSafeRelativePath', () => {
    it('should prefix with ./', () => {
      const result = buildSafeRelativePath('/workspace/images/file.png', '/workspace');
      expect(result).toBe('./images/file.png');
    });

    it('should handle same directory', () => {
      const result = buildSafeRelativePath('/workspace/file.png', '/workspace');
      expect(result).toBe('./file.png');
    });
  });

  describe('isValidDirectoryName', () => {
    it('should accept valid names', () => {
      expect(isValidDirectoryName('.claude-images')).toBe(true);
      expect(isValidDirectoryName('images')).toBe(true);
      expect(isValidDirectoryName('my-dir')).toBe(true);
    });

    it('should reject empty names', () => {
      expect(isValidDirectoryName('')).toBe(false);
      expect(isValidDirectoryName('   ')).toBe(false);
    });

    it('should reject . and ..', () => {
      expect(isValidDirectoryName('.')).toBe(false);
      expect(isValidDirectoryName('..')).toBe(false);
    });

    it('should reject names with path separators', () => {
      expect(isValidDirectoryName('path/name')).toBe(false);
      expect(isValidDirectoryName('path\\name')).toBe(false);
    });

    it('should reject names with null bytes', () => {
      expect(isValidDirectoryName('name\x00test')).toBe(false);
    });
  });
});
