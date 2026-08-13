/**
 * The tar parser in `scripts/fetch-cross-sharp.mjs`.
 *
 * That script unpacks the sharp binary that goes into the cross-target VSIXs,
 * so a bug here ships to users rather than failing a test. It parses tar by
 * hand because shelling out to `tar` is a coin flip on a Windows runner — the
 * GNU tar bundled with Git for Windows reads `C:\…` as a remote host.
 *
 * The fixtures are built by Python's `tarfile` (see `generate.py` beside them),
 * deliberately a different implementation from the one under test: a fixture
 * written by this parser's own logic would agree with it and prove nothing.
 * The real sharp tarballs contain none of these shapes, which is exactly why
 * they are pinned here — a future republish carrying a long path or a symlink
 * must not silently produce the wrong tree.
 *
 * The happy path is covered elsewhere and differently: the extraction of both
 * real tarballs was compared byte for byte against bsdtar.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { Refused, extract } from '../../scripts/fetch-cross-sharp.mjs';

const FIXTURES = resolve(__dirname, '../fixtures/tar');

/** Every file under `dir`, as posix-style paths, sorted. */
function filesIn(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        found.push(relative(dir, path).split('\\').join('/'));
      }
    }
  };
  walk(dir);
  return found.sort();
}

function unpack(fixture: string, destination: string): void {
  extract(fixture, readFileSync(join(FIXTURES, `${fixture}.tgz`)), destination);
}

describe('fetch-cross-sharp extract', () => {
  let out: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'clipshot-tar-'));
    mkdirSync(out, { recursive: true });
    return () => rmSync(out, { recursive: true, force: true });
  });

  it('recovers a path from a pax extended header', () => {
    // Over 100 bytes, so tar cannot hold it in the header's name field and
    // emits an 'x' record instead. Reading the short name would truncate it.
    unpack('pax-longpath', out);

    const files = filesIn(out);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^lib\/segment00\/.*\/segment13\/deep\.txt$/);
    expect(files[0]!.length).toBeGreaterThan(100);
    expect(statSync(join(out, files[0]!)).size).toBe(12);
  });

  it('handles explicit directory entries in GNU format', () => {
    unpack('gnu-dirs', out);

    expect(filesIn(out)).toEqual(['lib/a.node', 'package.json']);
  });

  it('refuses an entry that would escape the destination, writing nothing', () => {
    // `package/../../escaped.txt` leaves the destination once the leading
    // `package/` is stripped.
    expect(() => unpack('traversal', out)).toThrow(Refused);
    expect(() => unpack('traversal', out)).toThrow(/outside the destination/);
    expect(filesIn(out)).toEqual([]);
  });

  it('refuses an entry type it does not handle rather than skipping it', () => {
    // Skipping is the dangerous option: a GNU long-name header carries the
    // *next* entry's path, so ignoring it writes that file under a truncated
    // name. Stopping is what gets noticed.
    expect(() => unpack('symlink', out)).toThrow(Refused);
    expect(() => unpack('symlink', out)).toThrow(/unsupported tar entry type/);
  });

  it('preserves file modes', () => {
    unpack('modes', out);

    expect(filesIn(out)).toEqual(['exec.sh', 'plain.txt']);
    if (process.platform === 'win32') {
      return; // Windows does not carry the permission bits being asserted.
    }
    expect(statSync(join(out, 'exec.sh')).mode & 0o777).toBe(0o755);
    expect(statSync(join(out, 'plain.txt')).mode & 0o777).toBe(0o600);
  });
});
