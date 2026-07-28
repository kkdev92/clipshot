/**
 * Global test setup
 *
 * Replaces the `vscode` module with the mock suite published by
 * @kkdev92/vscode-ext-kit, so unit tests can import extension code without
 * an extension host. Individual test files may declare their own
 * `vi.mock('vscode', ...)` to extend this with extension-specific members
 * (ClipShot needs `env.clipboard` and `workspace.workspaceFolders`, which
 * are outside the library's mock surface).
 */

import { vi } from 'vitest';
import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';

vi.mock('vscode', () => createVSCodeMock(vi));
