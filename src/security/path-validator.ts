/**
 * Path validation utilities for security
 * Prevents path traversal attacks and symlink escapes
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { PathValidationError } from '../core/errors';
import { getPlatform } from './sanitizer';

/**
 * Validate that a target path is within the workspace root
 * Uses realpath to resolve symlinks and prevent escape attacks
 *
 * @param targetPath - The path to validate
 * @param workspaceRoot - The workspace root path
 * @returns True if path is valid and inside workspace
 * @throws PathValidationError if path is invalid or outside workspace
 */
export async function validatePathInsideWorkspace(
  targetPath: string,
  workspaceRoot: string
): Promise<boolean> {
  try {
    // Resolve workspace root to real path (resolve symlinks)
    const realWorkspaceRoot = await fs.realpath(workspaceRoot);

    // Normalize both paths
    const normalizedWorkspace = normalizePath(realWorkspaceRoot);

    // Check if target path exists
    let realTargetPath: string;
    try {
      // If target exists, resolve its real path
      realTargetPath = await fs.realpath(targetPath);
    } catch {
      // Target doesn't exist yet - validate parent directory
      const parentDir = path.dirname(targetPath);
      try {
        const realParentDir = await fs.realpath(parentDir);
        realTargetPath = path.join(realParentDir, path.basename(targetPath));
      } catch {
        // Parent doesn't exist - check the constructed path
        // This is acceptable for new directories that will be created
        const resolvedTarget = path.resolve(workspaceRoot, targetPath);
        realTargetPath = resolvedTarget;
      }
    }

    const normalizedTarget = normalizePath(realTargetPath);

    // Calculate relative path
    const relative = path.relative(normalizedWorkspace, normalizedTarget);

    // Check if path escapes workspace
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new PathValidationError(
        `Path '${targetPath}' is outside workspace`,
        'Path is outside the workspace'
      );
    }

    return true;
  } catch (error) {
    if (error instanceof PathValidationError) {
      throw error;
    }
    throw new PathValidationError(
      `Failed to validate path: ${error instanceof Error ? error.message : String(error)}`,
      'Invalid path'
    );
  }
}

/**
 * Check if a path contains parent directory traversal (..)
 *
 * @param inputPath - The path to check
 * @returns True if path contains parent traversal
 */
export function containsParentTraversal(inputPath: string): boolean {
  // Normalize path separators without resolving .. segments
  const normalized = inputPath.replace(/\\/g, '/');

  // Check for .. segments in the raw path (before resolution)
  const segments = normalized.split('/');
  return segments.some((segment) => segment === '..');
}

/**
 * Check if a path is absolute
 * Handles both Unix and Windows paths regardless of current platform
 *
 * @param inputPath - The path to check
 * @returns True if path is absolute
 */
export function isAbsolutePath(inputPath: string): boolean {
  // Unix absolute path
  if (inputPath.startsWith('/')) {
    return true;
  }
  // Windows absolute path (e.g., C:\, D:\)
  if (/^[A-Za-z]:[/\\]/.test(inputPath)) {
    return true;
  }
  return path.isAbsolute(inputPath);
}

/**
 * Validate that a path is a relative path without parent traversal
 *
 * @param inputPath - The path to validate
 * @throws PathValidationError if path is invalid
 */
export function validateRelativePath(inputPath: string): void {
  if (isAbsolutePath(inputPath)) {
    throw new PathValidationError(
      `Path '${inputPath}' is absolute, expected relative`,
      'Path must be relative'
    );
  }

  if (containsParentTraversal(inputPath)) {
    throw new PathValidationError(
      `Path '${inputPath}' contains parent directory traversal`,
      'Path cannot contain ..'
    );
  }
}

/**
 * Normalize a path for consistent comparison
 * Handles cross-platform differences
 *
 * @param inputPath - The path to normalize
 * @returns Normalized path
 */
export function normalizePath(inputPath: string): string {
  // Convert to forward slashes for consistent comparison
  let normalized = inputPath.replace(/\\/g, '/');

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');

  // Resolve . and .. segments
  const segments = normalized.split('/');
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === '.') {
      continue;
    }
    if (segment === '..') {
      result.pop();
    } else if (segment !== '') {
      result.push(segment);
    }
  }

  // Preserve leading slash for absolute paths
  if (normalized.startsWith('/')) {
    return '/' + result.join('/');
  }

  // Preserve drive letter for Windows
  const platform = getPlatform();
  if (platform === 'win32' && /^[a-zA-Z]:/.test(normalized)) {
    const drive = normalized.slice(0, 2);
    if (result[0] === drive.replace(':', '')) {
      result.shift();
    }
    return drive + '/' + result.join('/');
  }

  return result.join('/') || '.';
}

/**
 * Build a safe relative path from workspace root
 * Ensures the path starts with ./
 *
 * @param absolutePath - The absolute path
 * @param workspaceRoot - The workspace root
 * @returns Safe relative path starting with ./
 */
export function buildSafeRelativePath(
  absolutePath: string,
  workspaceRoot: string
): string {
  const relative = path.relative(workspaceRoot, absolutePath);
  const normalized = relative.replace(/\\/g, '/');

  // Ensure it starts with ./
  if (!normalized.startsWith('./') && !normalized.startsWith('../')) {
    return './' + normalized;
  }

  return normalized;
}

/**
 * Validate a directory name (single segment, no path separators)
 *
 * @param dirName - The directory name to validate
 * @returns True if valid
 */
export function isValidDirectoryName(dirName: string): boolean {
  // Must not be empty
  if (!dirName || dirName.trim() === '') {
    return false;
  }

  // Must not contain path separators
  if (dirName.includes('/') || dirName.includes('\\')) {
    return false;
  }

  // Must not be . or ..
  if (dirName === '.' || dirName === '..') {
    return false;
  }

  // Must not contain null bytes or control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(dirName)) {
    return false;
  }

  // Platform-specific checks
  const platform = getPlatform();
  if (platform === 'win32') {
    // Windows: no < > : " | ? *
    if (/[<>:"|?*]/.test(dirName)) {
      return false;
    }
    // No trailing dots or spaces
    if (/[.\s]$/.test(dirName)) {
      return false;
    }
  }

  return true;
}
