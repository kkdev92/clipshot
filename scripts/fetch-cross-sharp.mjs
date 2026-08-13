/**
 * Cross-platform sharp binary fetcher.
 *
 * ClipShot ships one VSIX per target, each carrying only its own platform's
 * sharp binary. On a runner building for its own platform, `npm ci` puts that
 * binary in place. The two cross targets — `linux-arm64` built on x64 Linux and
 * `win32-arm64` built on x64 Windows — need a binary npm will not install,
 * because it does not match the host's `os`/`cpu`.
 *
 * This used to be `npm install --cpu=… --os=… sharp@<version-from-lockfile>`.
 * Two problems with that, both real:
 *
 * - **npm 11 applies `--cpu`/`--os` to the whole dependency tree**, not to the
 *   named package — npm documents them as config that overrides `process.arch`
 *   and `process.platform` for the install, which is ambient rather than
 *   per-package. Installing an arm64 binary replaced the bundler's own x64 one,
 *   and the packaging step re-bundles through `vscode:prepublish`, so
 *   reordering does not help. That is why this repository is still on Node 22
 *   while everything else moved to 24.
 * - Under npm 10, which Node 22 ships, it did not prune the tree either — so
 *   the host's own binary stayed and went into the VSIX. See the note on the
 *   prune below; that is a shipping bug this replaces, not a risk it adds.
 * - It re-resolved from the registry, so what landed was pinned by version but
 *   not by content.
 *
 * The lockfile already records every platform package with its exact version,
 * its `resolved` URL and a sha512 `integrity`. Reading it directly is both
 * simpler and stricter: nothing is resolved, and a tarball whose hash does not
 * match the lockfile fails the build rather than being installed.
 *
 * Usage:
 *   node scripts/fetch-cross-sharp.mjs <vsce-target>
 *
 * Example:
 *   node scripts/fetch-cross-sharp.mjs linux-arm64
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Marks an error as one this script produced, so its stack is not printed. */
class Refused extends Error {}

/**
 * Aborts with a message rather than a stack trace: this runs in CI logs.
 *
 * Throws rather than calling `process.exit`, because exiting while a `fetch`
 * is in flight tears down libuv handles mid-flight — on Windows that aborts
 * with an assertion and exit code 127 instead of a clean 1, which reads as a
 * crash rather than as the check doing its job.
 */
function fail(message) {
  throw new Refused(message);
}

/**
 * The lockfile key for a package name.
 *
 * Every `@img/*` package sits at the top level of this tree, so the mapping is
 * flat. A nested copy would need the full path and is worth failing on rather
 * than guessing at.
 */
function lockKey(name) {
  return `node_modules/${name}`;
}

/** The only origin this script will fetch from. Every entry in the lockfile
 * resolves here; anything else is a lockfile worth stopping on. */
const REGISTRY = 'https://registry.npmjs.org';

/**
 * Refuses a `resolved` URL that does not point at the npm registry.
 *
 * The URL comes out of a file, which CodeQL flags (`js/file-access-to-http`)
 * and is right to: a request whose destination is read from a file should say
 * where it is allowed to go. `package-lock.json` is committed and reviewed, and
 * anyone able to edit it can already run code in this pipeline — but "the
 * source is trusted" is an argument, whereas this is a check, and it costs one
 * comparison. The integrity check covers tampered *content*; this covers a
 * request going somewhere it was never meant to.
 */
function assertRegistryUrl(name, resolved) {
  let url;
  try {
    url = new URL(resolved);
  } catch {
    fail(`${name} has an unparseable resolved URL in package-lock.json: ${resolved}`);
  }
  if (url.origin !== REGISTRY) {
    fail(
      `${name} resolves to ${url.origin}, not ${REGISTRY}.\n` +
        `   This script only fetches npm registry tarballs. Check the lockfile.`
    );
  }
  return `${REGISTRY}${url.pathname}`;
}

/**
 * Every package the target needs, from the lockfile.
 *
 * `@img/sharp-<target>` plus whatever it depends on — on Linux that is the
 * matching `@img/sharp-libvips-*`, on Windows nothing, because the Windows
 * packages carry libvips inside. Walked rather than hard-coded so a change in
 * how sharp splits its binaries is picked up instead of silently omitted.
 */
function collect(lock, rootName) {
  const seen = new Map();
  const queue = [rootName];

  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) {
      continue;
    }

    const entry = lock.packages[lockKey(name)];
    if (entry === undefined) {
      fail(`${name} is not in package-lock.json. Run \`npm install\` and commit the lockfile.`);
    }
    if (typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string') {
      fail(`${name} has no resolved URL or integrity in package-lock.json.`);
    }

    // The URL that gets fetched is rebuilt from the constant origin and the
    // validated path, so the destination host cannot come out of the file at
    // all — only the path within the registry can.
    seen.set(name, {
      version: entry.version,
      integrity: entry.integrity,
      url: assertRegistryUrl(name, entry.resolved),
    });
    queue.push(
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {})
    );
  }

  return seen;
}

/** Throws unless the bytes hash to what the lockfile recorded. */
function verifyIntegrity(name, bytes, integrity) {
  const [algorithm, expected] = integrity.split('-');
  if (algorithm !== 'sha512' && algorithm !== 'sha256' && algorithm !== 'sha1') {
    fail(`${name} records an unrecognised integrity algorithm: ${algorithm}`);
  }
  const actual = createHash(algorithm).update(bytes).digest('base64');
  if (actual !== expected) {
    fail(
      `${name} failed its integrity check.\n` +
        `   expected ${algorithm}-${expected}\n` +
        `   actual   ${algorithm}-${actual}`
    );
  }
}

const BLOCK = 512;

/** Reads a NUL- or space-terminated octal header field. */
function octal(header, offset, length) {
  const raw = header.toString('ascii', offset, offset + length).replace(/[\0 ]+$/, '').trim();
  return raw === '' ? 0 : Number.parseInt(raw, 8);
}

/**
 * Unpacks an npm tarball into `destination`, dropping the leading `package/`.
 *
 * Done in Node rather than by shelling out to `tar`, because which `tar` is on
 * PATH decides whether this works: the GNU tar that comes with Git for Windows
 * reads `C:\…` as a remote host and fails, while the bsdtar in System32 does
 * not. That is a coin flip on a Windows runner, and it is the kind of thing
 * that breaks a release rather than a test.
 *
 * npm tarballs are plain ustar with pax headers for long paths, so this
 * handles files, directories and the `path=` override, and refuses anything
 * that would write outside `destination`.
 */
function extract(label, tarball, destination) {
  const buffer = gunzipSync(tarball);
  let paxPath;

  for (let offset = 0; offset + BLOCK <= buffer.length; ) {
    const header = buffer.subarray(offset, offset + BLOCK);
    if (header[0] === 0) {
      break; // Two NUL blocks end the archive; one is enough to stop reading.
    }

    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const size = octal(header, 124, 12);
    const mode = octal(header, 100, 8);
    const type = String.fromCharCode(header[156] === 0 ? 0x30 : header[156]);
    const body = buffer.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x' || type === 'g') {
      // pax extended header: "<len> path=<value>\n" records.
      const record = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      paxPath = record?.[1];
      continue;
    }

    const entryPath = paxPath ?? name;
    paxPath = undefined;

    // Strip the `package/` prefix every npm tarball carries.
    const stripped = entryPath.split('/').slice(1).join('/');
    if (stripped === '') {
      continue;
    }

    const target = resolve(destination, stripped);
    const inside = relative(destination, target);
    if (inside === '' || inside.startsWith('..') || inside.startsWith(`..${sep}`)) {
      fail(`${label}: refusing to write outside the destination: ${entryPath}`);
    }

    if (type === '5') {
      mkdirSync(target, { recursive: true });
    } else if (type === '0') {
      mkdirSync(dirname(target), { recursive: true });
      // The mode is preserved because these are shared libraries and native
      // addons unpacked on the runner that packages them.
      writeFileSync(target, body, { mode: mode === 0 ? 0o644 : mode });
    } else {
      // Refused rather than skipped. A GNU long-name header ('L') carries the
      // *next* entry's path, so skipping it would write that file under its
      // truncated 100-byte name — a silent corruption. A link ('1'/'2') would
      // leave a dangling reference. Neither appears in these tarballs today;
      // if one does, stopping is the outcome that gets noticed.
      fail(`${label}: unsupported tar entry type '${type}' for ${entryPath}`);
    }
  }
}

async function main() {
  const target = process.argv[2];
  if (target === undefined || target === '') {
    fail('Usage: node scripts/fetch-cross-sharp.mjs <vsce-target>   (e.g. linux-arm64)');
  }

  const lock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));
  // The vsce target and the package suffix are the same string for every
  // target this project builds; the lookup in `collect` is what catches it if
  // that ever stops being true.
  const rootName = `@img/sharp-${target}`;
  const packages = collect(lock, rootName);

  console.log(`Fetching ${packages.size} package(s) for ${target}, pinned by package-lock.json:\n`);

  for (const [name, entry] of packages) {
    const destination = join(projectRoot, 'node_modules', ...name.split('/'));

    const response = await fetch(entry.url);
    if (!response.ok) {
      fail(`${name}: ${entry.url} returned HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    verifyIntegrity(name, bytes, entry.integrity);

    // Replaced rather than merged: a stale copy from `npm ci` would leave
    // files from the wrong architecture behind.
    if (existsSync(destination)) {
      rmSync(destination, { recursive: true, force: true });
    }
    extract(name, bytes, destination);

    console.log(`  ✓ ${name}@${entry.version}  (${entry.integrity.slice(0, 23)}…)`);
  }

  // `bundleDependencies: ["sharp"]` makes vsce ship sharp's whole installed
  // closure, and nothing in .vscodeignore excludes a platform package. So the
  // host's own binary — put there by `npm ci` — has to go, or the VSIX carries
  // two architectures.
  //
  // This is a fix, not a guard. The `npm install --cpu/--os` this replaced did
  // *not* prune, contrary to what it looked like: diffing the VSIXs the old
  // pipeline built against these, every cross-target release so far shipped the
  // build runner's own x64 binary — 17.8 MiB of Linux libvips inside the
  // linux-arm64 build, 18.3 MiB of Windows DLLs inside win32-arm64 — unused,
  // to users.
  const imgDir = join(projectRoot, 'node_modules', '@img');
  const stale = readdirSync(imgDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sharp-'))
    .filter((entry) => !packages.has(`@img/${entry.name}`))
    .filter((entry) => {
      // Only what the lockfile says is built for a particular platform.
      // `@img/sharp-wasm32` declares neither `os` nor `cpu`, because it is the
      // runtime sharp falls back to when no native binary matches the host —
      // and `verify-vsix.mjs` runs `require('sharp')` on the x64 runner that
      // cross-builds for arm64, so removing it broke that check. Anything the
      // lockfile does not describe is left alone rather than guessed at.
      const locked = lock.packages[lockKey(`@img/${entry.name}`)];
      return locked !== undefined && (locked.os !== undefined || locked.cpu !== undefined);
    });

  for (const entry of stale) {
    const directory = join(imgDir, entry.name);
    rmSync(directory, { recursive: true, force: true });
    // `force: true` treats a missing path as success, so a wrong path here
    // would report a removal that never happened. Checked rather than assumed.
    if (existsSync(directory)) {
      fail(`could not remove @img/${entry.name}; the VSIX would carry two architectures`);
    }
    console.log(`  − @img/${entry.name}  (built for another platform)`);
  }

  console.log(`\n✅ ${target} binaries in place\n`);
}

// Only when run as a command. Importing the module gives a test the real
// `extract` rather than a copy of it — a second implementation of a format
// parser would agree with itself and prove nothing.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    if (error instanceof Refused) {
      console.error(`\n❌ ${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

export { Refused, assertRegistryUrl, collect, extract, verifyIntegrity };
