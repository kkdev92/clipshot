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

import { PasteImage } from '../src/extension';
import { Settings } from '../src/config/schema';

interface ManifestShape {
  contributes?: {
    configuration?: { properties?: Record<string, Record<string, unknown>> };
  };
}

const manifest = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
) as ManifestShape;

/**
 * The key whose manifest type the checker cannot compare.
 *
 * `resize.preset` defaults to null, so the manifest has to say
 * `"type": ["string","null"]` for the settings editor to accept that default.
 * A `SettingSpec.type` is a single string, and the checker compares the two
 * with `!==` — an array can therefore never match, whatever `src` says.
 *
 * The key stays in the comparison so that its default and its enum members are
 * still checked, and so it is not reported as contributed-but-unread. Only its
 * `type` is normalised, in a copy, and the real value is asserted below.
 */
const NULLABLE_KEY = `${Settings.section}.resize.preset`;

function withNormalisedUnionType(source: ManifestShape): ManifestShape {
  const copy = structuredClone(source);
  const entry = copy.contributes?.configuration?.properties?.[NULLABLE_KEY];
  if (entry !== undefined) {
    entry['type'] = 'string';
  }
  return copy;
}

describe('package.json', () => {
  it('declares what src declares', () => {
    assertManifestMatches(withNormalisedUnionType(manifest), {
      settings: [Settings],
      commands: [PasteImage],
    });
  });

  it('declares resize.preset as a nullable string', () => {
    // Normalised away above, so this is the only thing checking it.
    const entry = manifest.contributes?.configuration?.properties?.[NULLABLE_KEY];

    expect(entry?.['type']).toEqual(['string', 'null']);
  });
});
