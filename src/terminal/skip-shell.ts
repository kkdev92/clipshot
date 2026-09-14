/**
 * Keeping `Ctrl+Shift+V` alive while the integrated terminal has focus.
 *
 * A keybinding pressed in the terminal is not the extension's by default. The
 * key event goes to xterm.js, and VS Code only takes it back for commands
 * listed in `terminal.integrated.commandsToSkipShell` — everything else is the
 * shell's. That distinction used to be invisible here: xterm.js had no encoding
 * for `Ctrl+Shift+V`, so it left the DOM event alone, the event bubbled up to
 * the keybinding service, and the shortcut ran anyway. It worked by omission
 * rather than by right.
 *
 * What ends that is the kitty keyboard protocol. VS Code's terminal supports it
 * (`terminal.integrated.enableKittyKeyboardProtocol`, on by default) but leaves
 * it dormant until a program running in the terminal asks for it. Once asked,
 * xterm.js encodes chords it previously ignored — `ctrl+shift+letter` is named
 * in the protocol as one of the combinations it disambiguates — and consumes
 * the event where it is. Nothing bubbles, the keybinding never resolves, and
 * the paste goes quiet with no error to show for it. Which program is running
 * decides whether the shortcut works, which is no way to ship a keybinding.
 *
 * The skip list is the only lever. VS Code has no contribution point for it, and
 * the set is rebuilt from the setting alone, so being on it means writing to it.
 * That is what this module does: once, additively, to User settings.
 *
 * Two things keep that honest. The write appends to the *user's own* entries —
 * read through `inspect()`, never the effective value, which would copy the
 * commands VS Code ships into the user's settings.json and freeze them there.
 * And an explicit `-clipshot.pasteImage`, VS Code's own syntax for removing an
 * entry, is read as the answer it is and left alone.
 */

import * as vscode from 'vscode';

import type { Logger } from '../core/types';

/** The section and key VS Code resolves the skip list from. */
export const SKIP_SHELL_SECTION = 'terminal.integrated';
export const SKIP_SHELL_KEY = 'commandsToSkipShell';

/** What the configured list already says about a command. */
export type SkipShellState =
  /** Absent: nothing has an opinion, so the entry can be added. */
  | 'unregistered'
  /** Present: the shortcut already reaches the extension. */
  | 'registered'
  /** Present as `-command`: the user took it off the list on purpose. */
  | 'opted-out';

/** What `ensureSkipShellEntry` did. */
export type SkipShellOutcome = SkipShellState | 'added' | 'failed';

/**
 * Reads the configured list the way VS Code does.
 *
 * VS Code replays the array in order over its own defaults, adding each entry
 * and deleting the ones written as `-command`, so a later entry overrides an
 * earlier one and the last mention is the one that counts. Scanning to the end
 * rather than returning on the first hit is what mirrors that.
 */
export function readSkipShellState(
  command: string,
  configured: readonly string[] | undefined
): SkipShellState {
  const removal = `-${command}`;
  let state: SkipShellState = 'unregistered';
  for (const entry of configured ?? []) {
    if (entry === command) {
      state = 'registered';
    } else if (entry === removal) {
      state = 'opted-out';
    }
  }
  return state;
}

/**
 * The user's own entries with `command` on the end.
 *
 * A stale `-command` is dropped rather than left to fight the entry being
 * added; anything else the user wrote is preserved in place.
 */
export function appendSkipShellEntry(
  userEntries: readonly string[] | undefined,
  command: string
): string[] {
  const kept = (userEntries ?? []).filter((entry) => entry !== `-${command}`);
  return kept.includes(command) ? kept : [...kept, command];
}

/**
 * Puts `command` on the skip list unless something already decided otherwise.
 *
 * Never throws. A settings write can fail for reasons this extension has no
 * answer to — a read-only settings.json, a policy-managed value — and none of
 * them are worth failing activation over: the shortcut still works everywhere
 * except the terminal, which is where it was before this ran.
 */
export async function ensureSkipShellEntry(
  command: string,
  logger: Logger
): Promise<SkipShellOutcome> {
  const configuration = vscode.workspace.getConfiguration(SKIP_SHELL_SECTION);

  const state = readSkipShellState(command, configuration.get<string[]>(SKIP_SHELL_KEY));
  if (state !== 'unregistered') {
    logger.debug('Terminal shortcut needs no change', { command, state });
    return state;
  }

  // `globalValue`, not the effective value: see the note at the top of the file.
  const userEntries = configuration.inspect<string[]>(SKIP_SHELL_KEY)?.globalValue;

  try {
    await configuration.update(
      SKIP_SHELL_KEY,
      appendSkipShellEntry(userEntries, command),
      vscode.ConfigurationTarget.Global
    );
  } catch (error) {
    logger.warn('Could not register the terminal shortcut', {
      command,
      setting: `${SKIP_SHELL_SECTION}.${SKIP_SHELL_KEY}`,
      reason: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }

  logger.info('Registered the terminal shortcut', {
    command,
    setting: `${SKIP_SHELL_SECTION}.${SKIP_SHELL_KEY}`,
  });
  return 'added';
}

/** One line a user can act on, for each way this can end. */
export function describeSkipShellOutcome(outcome: SkipShellOutcome): string {
  switch (outcome) {
    case 'added':
      return 'Ctrl+Shift+V now works in the integrated terminal. ClipShot added clipshot.pasteImage to terminal.integrated.commandsToSkipShell in your User settings.';
    case 'registered':
      return 'Ctrl+Shift+V already works in the integrated terminal — clipshot.pasteImage is on terminal.integrated.commandsToSkipShell.';
    case 'opted-out':
      return 'terminal.integrated.commandsToSkipShell lists -clipshot.pasteImage, so ClipShot left it alone. Remove that entry to use Ctrl+Shift+V in the integrated terminal.';
    case 'unregistered':
    case 'failed':
      return 'ClipShot could not update terminal.integrated.commandsToSkipShell. Add "clipshot.pasteImage" to it by hand to use Ctrl+Shift+V in the integrated terminal.';
  }
}
