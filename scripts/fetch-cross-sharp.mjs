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
 *   named package. Installing an arm64 binary replaced the bundler's own x64
 *   one, and the packaging step re-bundles through `vscode:prepublish`, so
 *   reordering does not help. That is why this repository is still on Node 22
 *   while everything else moved to 24.
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
import { fileURLToPath } from 'node:url';
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

    seen.set(name, entry);
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
    }
    // Anything else — links, devices, GNU extensions — is not in an npm
    // tarball for a prebuilt binary, and silently skipping is right for the
    // ones that are (`pax_global_header` is handled above).
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

    const response = await fetch(entry.resolved);
    if (!response.ok) {
      fail(`${name}: ${entry.resolved} returned HTTP ${response.status}`);
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
  // two architectures. Measured: leaving it in added 17.5 MB of Linux binaries
  // to a Windows build.
  //
  // The old `npm install --cpu/--os` got this for free, as a side effect of
  // re-evaluating the tree for the target platform. Doing it here is the same
  // outcome, said out loud.
  const imgDir = join(projectRoot, 'node_modules', '@img');
  const stale = readdirSync(imgDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sharp-'))
    .filter((entry) => !packages.has(`@img/${entry.name}`));

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
