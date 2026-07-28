/**
 * Global test setup
 *
 * Replaces the `vscode` module with the mock suite published by
 * @kkdev92/vscode-ext-kit, so unit tests can import extension code without
 * an extension host. The mock covers everything ClipShot touches —
 * `window.activeTextEditor`, `workspace.workspaceFolders` and
 * `env.clipboard` included — so test files can assign to those directly
 * instead of composing their own mock.
 */

import { vi } from 'vitest';
import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';

vi.mock('vscode', () => createVSCodeMock(vi));
