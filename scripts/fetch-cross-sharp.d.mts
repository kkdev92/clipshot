/**
 * Types for the parts of `fetch-cross-sharp.mjs` a test drives.
 *
 * Hand-written rather than generated: the script is plain ESM run by `node`
 * in CI, and adding `allowJs` to the test project to type one file would widen
 * what the whole project checks.
 */

/** Thrown for every condition the script refuses, so a test can tell one of
 * its own failures from an unexpected crash. */
export declare class Refused extends Error {}

/** Unpacks an npm tarball into `destination`, dropping the leading `package/`. */
export declare function extract(label: string, tarball: Buffer, destination: string): void;

/** Returns the registry URL for `resolved`, or throws {@link Refused}. */
export declare function assertRegistryUrl(name: string, resolved: string): string;

/** Throws {@link Refused} unless `bytes` hash to `integrity`. */
export declare function verifyIntegrity(name: string, bytes: Buffer, integrity: string): void;

/** Walks the lockfile from `rootName`, returning what has to be fetched. */
export declare function collect(
  lock: { packages: Record<string, unknown> },
  rootName: string
): Map<string, { version: string; integrity: string; url: string }>;
