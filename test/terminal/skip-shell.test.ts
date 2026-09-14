/**
 * The terminal skip-list registration.
 *
 * Two things here are worth more than the rest. The first is that the entry is
 * appended to the *user's* value and never to the effective one: VS Code merges
 * a long list of its own commands into what `get()` returns, and writing
 * that back would pin today's defaults into the user's settings.json forever.
 * The second is that `-clipshot.pasteImage` is an answer, not a leftover — a
 * user who wrote it is not asked again.
 */

import { createMockLogger } from '@kkdev92/vscode-ext-kit/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import {
  SKIP_SHELL_KEY,
  SKIP_SHELL_SECTION,
  appendSkipShellEntry,
  describeSkipShellOutcome,
  ensureSkipShellEntry,
  readSkipShellState,
} from '../../src/terminal/skip-shell';
import type { Logger } from '../../src/core/types';

const COMMAND = 'clipshot.pasteImage';

/** What VS Code hands back for `terminal.integrated`, narrowed to what is used. */
type Configuration = {
  get: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function useConfiguration(configuration: Configuration): void {
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
    configuration as unknown as vscode.WorkspaceConfiguration
  );
}

describe('readSkipShellState', () => {
  it('reports an unset list as unregistered', () => {
    expect(readSkipShellState(COMMAND, undefined)).toBe('unregistered');
    expect(readSkipShellState(COMMAND, [])).toBe('unregistered');
  });

  it('reports an unrelated list as unregistered', () => {
    expect(readSkipShellState(COMMAND, ['workbench.action.terminal.paste'])).toBe('unregistered');
  });

  it('recognises the command', () => {
    expect(readSkipShellState(COMMAND, ['a', COMMAND, 'b'])).toBe('registered');
  });

  it("reads VS Code's removal syntax as an opt-out", () => {
    expect(readSkipShellState(COMMAND, [`-${COMMAND}`])).toBe('opted-out');
  });

  it('lets the last mention win, as VS Code does when it replays the list', () => {
    expect(readSkipShellState(COMMAND, [`-${COMMAND}`, COMMAND])).toBe('registered');
    expect(readSkipShellState(COMMAND, [COMMAND, `-${COMMAND}`])).toBe('opted-out');
  });
});

describe('appendSkipShellEntry', () => {
  it('appends to an unset value', () => {
    expect(appendSkipShellEntry(undefined, COMMAND)).toEqual([COMMAND]);
  });

  it('keeps what the user already wrote, in order', () => {
    expect(appendSkipShellEntry(['x', 'y'], COMMAND)).toEqual(['x', 'y', COMMAND]);
  });

  it('does not add a second copy', () => {
    expect(appendSkipShellEntry(['x', COMMAND], COMMAND)).toEqual(['x', COMMAND]);
  });

  it('drops a stale removal rather than leaving it to fight the entry', () => {
    expect(appendSkipShellEntry(['x', `-${COMMAND}`], COMMAND)).toEqual(['x', COMMAND]);
  });
});

describe('ensureSkipShellEntry', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger(vi);
  });

  it('adds the command and reports it', async () => {
    const configuration: Configuration = {
      get: vi.fn().mockReturnValue(['workbench.action.terminal.paste']),
      inspect: vi.fn().mockReturnValue({ globalValue: ['my.command'] }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    useConfiguration(configuration);

    await expect(ensureSkipShellEntry(COMMAND, logger)).resolves.toBe('added');

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(SKIP_SHELL_SECTION);
    expect(configuration.update).toHaveBeenCalledWith(
      SKIP_SHELL_KEY,
      ['my.command', COMMAND],
      vscode.ConfigurationTarget.Global
    );
  });

  it("writes the user's own entries, never the value VS Code merged", async () => {
    // `get()` returns the defaults too. Writing those back would freeze the
    // list VS Code ships into the user's settings.json.
    const merged = ['workbench.action.terminal.paste', 'workbench.action.showCommands'];
    const configuration: Configuration = {
      get: vi.fn().mockReturnValue(merged),
      inspect: vi.fn().mockReturnValue({ globalValue: undefined }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    useConfiguration(configuration);

    await expect(ensureSkipShellEntry(COMMAND, logger)).resolves.toBe('added');

    expect(configuration.update).toHaveBeenCalledWith(
      SKIP_SHELL_KEY,
      [COMMAND],
      vscode.ConfigurationTarget.Global
    );
  });

  it('leaves an already-registered list alone', async () => {
    const configuration: Configuration = {
      get: vi.fn().mockReturnValue([COMMAND]),
      inspect: vi.fn(),
      update: vi.fn(),
    };
    useConfiguration(configuration);

    await expect(ensureSkipShellEntry(COMMAND, logger)).resolves.toBe('registered');
    expect(configuration.update).not.toHaveBeenCalled();
  });

  it('respects an explicit opt-out', async () => {
    const configuration: Configuration = {
      get: vi.fn().mockReturnValue([`-${COMMAND}`]),
      inspect: vi.fn(),
      update: vi.fn(),
    };
    useConfiguration(configuration);

    await expect(ensureSkipShellEntry(COMMAND, logger)).resolves.toBe('opted-out');
    expect(configuration.update).not.toHaveBeenCalled();
  });

  it('reports a failed write instead of throwing', async () => {
    const configuration: Configuration = {
      get: vi.fn().mockReturnValue([]),
      inspect: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockRejectedValue(new Error('settings.json is read-only')),
    };
    useConfiguration(configuration);

    await expect(ensureSkipShellEntry(COMMAND, logger)).resolves.toBe('failed');
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('describeSkipShellOutcome', () => {
  it('says something actionable for every outcome', () => {
    for (const outcome of ['added', 'registered', 'opted-out', 'unregistered', 'failed'] as const) {
      expect(describeSkipShellOutcome(outcome)).toMatch(/terminal/i);
    }
  });

  it('names the setting to edit when it could not write one', () => {
    expect(describeSkipShellOutcome('failed')).toContain('terminal.integrated.commandsToSkipShell');
    expect(describeSkipShellOutcome('opted-out')).toContain(`-${COMMAND}`);
  });
});
