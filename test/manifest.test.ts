/**
 * package.json against what `src` declares.
 *
 * VS Code reads the manifest before any extension code runs, so the two cannot
 * become one file — but the overlap between them is small, mechanical, and
 * exactly the kind of thing that drifts silently: an id, a type, a default, an
 * enum member. Nothing else in this suite would notice. A failure here names
 * every disagreement at once and prints the JSON to paste, so the fix is always
 * "update the manifest".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertManifestMatches } from '@kkdev92/vscode-ext-kit/testing';
import { describe, expect, it } from 'vitest';

import { EnableInTerminal, PasteImage } from '../src/extension';
import { Settings } from '../src/config/schema';

const manifest: unknown = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
);

/**
 * The keybinding pair, in the order it has to be written.
 *
 * `assertManifestMatches` does not look at keybindings — reasonably, since a
 * keybinding is normally presentation. This pair is not: it is how the paste
 * command learns where the focus is, because VS Code exposes no runtime API
 * for that and `window.activeTextEditor` answers a different question.
 *
 * The order is load-bearing. VS Code weights an extension's keybindings by
 * their index in this array and resolves from the highest weight down, taking
 * the first whose `when` clause holds — so the `terminalFocus` entry only wins
 * while it is the later of the two. Swap them, drop the `when`, or change the
 * `args` and `Ctrl+Shift+V` in a terminal goes quietly back to writing into a
 * background editor, which is the bug in issue #69. Nothing else in this suite
 * would see it.
 *
 * The command id is deliberately the same in both. VS Code checks
 * `terminal.integrated.commandsToSkipShell` against the id a keybinding
 * resolves to, so keeping it means the entry ClipShot wrote once in 0.6.0
 * still covers the terminal route — no second migration of anyone's settings.
 */
const EXPECTED_KEYBINDINGS = [
  {
    command: PasteImage.descriptor.id,
    key: 'ctrl+shift+v',
    mac: 'cmd+shift+v',
  },
  {
    command: PasteImage.descriptor.id,
    key: 'ctrl+shift+v',
    mac: 'cmd+shift+v',
    when: 'terminalFocus',
    args: { surface: 'terminal' },
  },
];

describe('package.json', () => {
  it('declares what src declares', () => {
    // Including the three nullable settings. `resize.preset` defaults to null,
    // so its manifest type has to be `["string","null"]` — which is compared
    // here as it is written, rather than normalised away first.
    assertManifestMatches(manifest, {
      settings: [Settings],
      commands: [PasteImage, EnableInTerminal],
    });
  });

  it('contributes the keybinding pair the terminal routing depends on', () => {
    const { contributes } = manifest as { contributes: { keybindings?: unknown } };
    expect(contributes.keybindings).toEqual(EXPECTED_KEYBINDINGS);
  });
});
