/**
 * Tests for custom error classes
 */

import { describe, it, expect } from 'vitest';
import {
  ClipShotError,
  ClipboardError,
  NoImageError,
  ImageProcessingError,
  FileOperationError,
  ConfigurationError,
  PathValidationError,
  FileSizeLimitError,
  PlatformNotSupportedError,
  NoWorkspaceError,
  isClipShotError,
  getUserErrorMessage,
} from '../../src/core/errors';

describe('Error Classes', () => {
  describe('ClipShotError (base class)', () => {
    it('should have correct properties', () => {
      const error = new ClipShotError('test message', 'TEST_CODE', 'user friendly message');

      expect(error.message).toBe('test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.userMessage).toBe('user friendly message');
      expect(error.name).toBe('ClipShotError');
    });

    it('should work without userMessage', () => {
      const error = new ClipShotError('test message', 'TEST_CODE');

      expect(error.message).toBe('test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.userMessage).toBeUndefined();
    });

    it('should be instance of Error', () => {
      const error = new ClipShotError('test', 'CODE');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ClipShotError);
    });

    it('should have correct prototype chain', () => {
      const error = new ClipShotError('test', 'CODE');

      expect(Object.getPrototypeOf(error)).toBe(ClipShotError.prototype);
    });
  });

  describe('ClipboardError', () => {
    it('should have correct default userMessage', () => {
      const error = new ClipboardError('internal clipboard error');

      expect(error.message).toBe('internal clipboard error');
      expect(error.code).toBe('CLIPBOARD_ERROR');
      expect(error.userMessage).toBe('Failed to read clipboard');
      expect(error.name).toBe('ClipboardError');
    });

    it('should accept custom userMessage', () => {
      const error = new ClipboardError('internal error', 'Custom clipboard message');

      expect(error.userMessage).toBe('Custom clipboard message');
    });

    it('should be instanceof ClipShotError', () => {
      const error = new ClipboardError('test');

      expect(error).toBeInstanceOf(ClipShotError);
      expect(error).toBeInstanceOf(ClipboardError);
    });
  });

  describe('NoImageError', () => {
    it('should have correct properties', () => {
      const error = new NoImageError();

      expect(error.message).toBe('No image found in clipboard');
      expect(error.code).toBe('NO_IMAGE');
      expect(error.userMessage).toBe('No image in clipboard');
      expect(error.name).toBe('NoImageError');
    });

    it('should be instanceof ClipShotError', () => {
      const error = new NoImageError();

      expect(error).toBeInstanceOf(ClipShotError);
      expect(error).toBeInstanceOf(NoImageError);
    });
  });

  describe('ImageProcessingError', () => {
    it('should have correct default userMessage', () => {
      const error = new ImageProcessingError('Sharp processing failed');

      expect(error.message).toBe('Sharp processing failed');
      expect(error.code).toBe('IMAGE_PROCESSING_ERROR');
      expect(error.userMessage).toBe('Failed to process image');
      expect(error.name).toBe('ImageProcessingError');
    });

    it('should accept custom userMessage', () => {
      const error = new ImageProcessingError('internal', 'Image format not supported');

      expect(error.userMessage).toBe('Image format not supported');
    });

    it('should be instanceof ClipShotError', () => {
      const error = new ImageProcessingError('test');

      expect(error).toBeInstanceOf(ClipShotError);
      expect(error).toBeInstanceOf(ImageProcessingError);
    });
  });

  describe('FileOperationError', () => {
    it('should have correct default userMessage', () => {
      const error = new FileOperationError('EACCES permission denied');

      expect(error.message).toBe('EACCES permission denied');
      expect(error.code).toBe('FILE_OPERATION_ERROR');
      expect(error.userMessage).toBe('Failed to save image');
      expect(error.name).toBe('FileOperationError');
    });

    it('should accept custom userMessage', () => {
      const error = new FileOperationError('internal', 'Disk is full');

      expect(error.userMessage).toBe('Disk is full');
    });

    it('should be instanceof ClipShotError', () => {
      const error = new FileOperationError('test');

      expect(error).toBeInstanceOf(ClipShotError);
      expect(error).toBeInstanceOf(FileOperationError);
    });
  });

  describe('ConfigurationError', () => {
    it('should have correct properties with invalidFields', () => {
      const error = new ConfigurationError('Invalid config', ['saveDirectory', 'jpegQuality']);

      expect(error.message).toBe('Invalid config');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.userMessage).toBe('Invalid configuration');
      expect(error.name).toBe('ConfigurationError');
      expect(error.invalidFields).toEqual(['saveDirectory', 'jpegQuality']);
    });

    it('should accept empty invalidFields array', () => {
      const error = new ConfigurationError('Config error', []);

      expect(error.invalidFields).toEqual([]);
    });

    it('should be instanceof ClipShotError', () => {
      const error = new ConfigurationError('test', []);

      expect(error).toBeInstanceOf(ClipShotError);
      expect(error).toBeInstanceOf(ConfigurationError);
    });
  });

  describe('PathValidationError', () => {
    it('should have correct default userMessage', () => {
      const error = new PathValidationError('Path traversal detected');

      expect(error.message).toBe('Path traversal detected');
      expect(error.code).toBe('PATH_VALIDATION_ERROR');
      expect(error.userMessage).toBe('Invalid path');
      expect(error.name).toBe('PathValidationError');
    });

    it('should accept custom userMessage', () => {
      const error = new PathValidationError('internal', 'Path contains invalid characters');

      expect(error.userMessage).toBe('Path contains invalid characters');
    });

    it('should be instanceof ClipShotError', () => {
      const error = new PathValidationError('test');

      expect(error).toBeInstanceOf(ClipShotError);
      expect(error).toBeInstanceOf(PathValidationError);
    });
  });

  describe('FileSizeLimitError', () => {
    it('should format file size correctly', () => {
      const error = new FileSizeLimitError(15.5, 10);

      expect(error.message).toBe('File size 15.50MB exceeds limit 10MB');
      expect(error.code).toBe('FILE_SIZE_LIMIT');
      expect(error.userMessage).toBe('Image too large (15.5MB > 10MB)');
      expect(error.name).toBe('FileSizeLimitError');
    });

    it('should handle small file sizes', () => {
      const error = new FileSizeLimitError(0.12, 0.1);

      expect(error.message).toBe('File size 0.12MB exceeds limit 0.1MB');
      expect(error.userMessage).toBe('Image too large (0.1MB > 0.1MB)');
    });

    it('should handle large file sizes', () => {
      const error = new FileSizeLimitError(150.789, 100);

      expect(error.message).toBe('File size 150.79MB exceeds limit 100MB');
      expect(error.userMessage).toBe('Image too large (150.8MB > 100MB)');
    });

    it('should be instanceof ClipShotError', () => {
      const error = new FileSizeLimitError(10, 5);

      expect(error).toBeInstanceOf(ClipShotError);
      expect(error).toBeInstanceOf(FileSizeLimitError);
    });
  });

  describe('PlatformNotSupportedError', () => {
    it('should include platform name in messages', () => {
      const error = new PlatformNotSupportedError('freebsd');

      expect(error.message).toBe("Platform 'freebsd' is not supported");
      expect(error.code).toBe('PLATFORM_NOT_SUPPORTED');
      expect(error.userMessage).toBe('This platform (freebsd) is not supported');
      expect(error.name).toBe('PlatformNotSupportedError');
    });

    it('should handle different platform names', () => {
      const error = new PlatformNotSupportedError('sunos');

      expect(error.message).toContain('sunos');
      expect(error.userMessage).toContain('sunos');
    });

    it('should be instanceof ClipShotError', () => {
      const error = new PlatformNotSupportedError('unknown');

      expect(error).toBeInstanceOf(ClipShotError);
      expect(error).toBeInstanceOf(PlatformNotSupportedError);
    });
  });

  describe('NoWorkspaceError', () => {
    it('should have correct properties', () => {
      const error = new NoWorkspaceError();

      expect(error.message).toBe('No workspace folder is open');
      expect(error.code).toBe('NO_WORKSPACE');
      expect(error.userMessage).toBe('Please open a folder to use this extension');
      expect(error.name).toBe('NoWorkspaceError');
    });

    it('should be instanceof ClipShotError', () => {
      const error = new NoWorkspaceError();

      expect(error).toBeInstanceOf(ClipShotError);
      expect(error).toBeInstanceOf(NoWorkspaceError);
    });
  });
});

describe('isClipShotError', () => {
  it('should return true for ClipShotError', () => {
    const error = new ClipShotError('test', 'CODE');

    expect(isClipShotError(error)).toBe(true);
  });

  it('should return true for derived error classes', () => {
    expect(isClipShotError(new ClipboardError('test'))).toBe(true);
    expect(isClipShotError(new NoImageError())).toBe(true);
    expect(isClipShotError(new ImageProcessingError('test'))).toBe(true);
    expect(isClipShotError(new FileOperationError('test'))).toBe(true);
    expect(isClipShotError(new ConfigurationError('test', []))).toBe(true);
    expect(isClipShotError(new PathValidationError('test'))).toBe(true);
    expect(isClipShotError(new FileSizeLimitError(10, 5))).toBe(true);
    expect(isClipShotError(new PlatformNotSupportedError('test'))).toBe(true);
    expect(isClipShotError(new NoWorkspaceError())).toBe(true);
  });

  it('should return false for standard Error', () => {
    const error = new Error('standard error');

    expect(isClipShotError(error)).toBe(false);
  });

  it('should return false for TypeError', () => {
    const error = new TypeError('type error');

    expect(isClipShotError(error)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isClipShotError(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isClipShotError(undefined)).toBe(false);
  });

  it('should return false for plain objects', () => {
    const fakeError = { message: 'fake', code: 'FAKE', userMessage: 'fake' };

    expect(isClipShotError(fakeError)).toBe(false);
  });

  it('should return false for strings', () => {
    expect(isClipShotError('error message')).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(isClipShotError(42)).toBe(false);
  });
});

describe('getUserErrorMessage', () => {
  describe('with ClipShotError', () => {
    it('should return userMessage when available', () => {
      const error = new ClipShotError('internal', 'CODE', 'user friendly');

      expect(getUserErrorMessage(error)).toBe('user friendly');
    });

    it('should return message when userMessage is undefined', () => {
      const error = new ClipShotError('internal message', 'CODE');

      expect(getUserErrorMessage(error)).toBe('internal message');
    });

    it('should work with derived error classes', () => {
      expect(getUserErrorMessage(new NoImageError())).toBe('No image in clipboard');
      expect(getUserErrorMessage(new ClipboardError('internal'))).toBe('Failed to read clipboard');
      expect(getUserErrorMessage(new NoWorkspaceError())).toBe('Please open a folder to use this extension');
    });

    it('should return custom userMessage from derived classes', () => {
      const error = new ClipboardError('internal', 'Custom message');

      expect(getUserErrorMessage(error)).toBe('Custom message');
    });
  });

  describe('with standard Error', () => {
    it('should return error message', () => {
      const error = new Error('standard error message');

      expect(getUserErrorMessage(error)).toBe('standard error message');
    });

    it('should work with TypeError', () => {
      const error = new TypeError('cannot read property');

      expect(getUserErrorMessage(error)).toBe('cannot read property');
    });

    it('should work with RangeError', () => {
      const error = new RangeError('out of range');

      expect(getUserErrorMessage(error)).toBe('out of range');
    });
  });

  describe('with non-Error values', () => {
    it('should return default message for null', () => {
      expect(getUserErrorMessage(null)).toBe('An unknown error occurred');
    });

    it('should return default message for undefined', () => {
      expect(getUserErrorMessage(undefined)).toBe('An unknown error occurred');
    });

    it('should return default message for plain objects', () => {
      expect(getUserErrorMessage({ message: 'not an error' })).toBe('An unknown error occurred');
    });

    it('should return default message for strings', () => {
      expect(getUserErrorMessage('error string')).toBe('An unknown error occurred');
    });

    it('should return default message for numbers', () => {
      expect(getUserErrorMessage(500)).toBe('An unknown error occurred');
    });

    it('should return default message for arrays', () => {
      expect(getUserErrorMessage(['error1', 'error2'])).toBe('An unknown error occurred');
    });
  });
});

describe('Error inheritance chain', () => {
  it('all derived errors should be catchable as ClipShotError', () => {
    const errors = [
      new ClipboardError('test'),
      new NoImageError(),
      new ImageProcessingError('test'),
      new FileOperationError('test'),
      new ConfigurationError('test', []),
      new PathValidationError('test'),
      new FileSizeLimitError(10, 5),
      new PlatformNotSupportedError('test'),
      new NoWorkspaceError(),
    ];

    for (const error of errors) {
      try {
        throw error;
      } catch (e) {
        expect(e).toBeInstanceOf(ClipShotError);
        expect(e).toBeInstanceOf(Error);
      }
    }
  });

  it('all derived errors should have unique names', () => {
    const errors = [
      new ClipShotError('test', 'CODE'),
      new ClipboardError('test'),
      new NoImageError(),
      new ImageProcessingError('test'),
      new FileOperationError('test'),
      new ConfigurationError('test', []),
      new PathValidationError('test'),
      new FileSizeLimitError(10, 5),
      new PlatformNotSupportedError('test'),
      new NoWorkspaceError(),
    ];

    const names = errors.map((e) => e.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(errors.length);
  });

  it('all derived errors should have unique codes', () => {
    const errors = [
      new ClipboardError('test'),
      new NoImageError(),
      new ImageProcessingError('test'),
      new FileOperationError('test'),
      new ConfigurationError('test', []),
      new PathValidationError('test'),
      new FileSizeLimitError(10, 5),
      new PlatformNotSupportedError('test'),
      new NoWorkspaceError(),
    ];

    const codes = errors.map((e) => e.code);
    const uniqueCodes = new Set(codes);

    expect(uniqueCodes.size).toBe(errors.length);
  });
});
