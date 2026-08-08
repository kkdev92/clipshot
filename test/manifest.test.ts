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
import { describe, it } from 'vitest';

import { PasteImage } from '../src/extension';
import { Settings } from '../src/config/schema';

const manifest: unknown = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
);

describe('package.json', () => {
  it('declares what src declares', () => {
    // Including the three nullable settings. `resize.preset` defaults to null,
    // so its manifest type has to be `["string","null"]` — which is compared
    // here as it is written, rather than normalised away first.
    assertManifestMatches(manifest, {
      settings: [Settings],
      commands: [PasteImage],
    });
  });
});
