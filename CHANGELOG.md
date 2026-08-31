# Changelog

All notable changes to the ClipShot extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-08-31

### Changed

- `@kkdev92/vscode-ext-kit` `^4.0.0` → `^4.1.0`. The framework's 4.1 is about
  introspection and tooling; its API is additive and the VS Code floor is
  unchanged, so nothing in this extension's source moves.

  **The bundle grows by 6,361 bytes (253,990 → 260,351), and the growth is
  accounted for.** Built against both kit versions and compared: all of it is
  framework runtime this extension links — a preflight failure reported as
  data, a shutdown timeout that names what was holding it, `inspect()` on both
  scope kinds, and `defineExtension` refusing a second activation after
  deactivation. Nothing reached only through a test or the command line enters
  the bundle.

  That last change is the framework documenting how a real extension host
  behaves — one activation per session — and this repository's activation
  suite was the counterexample: it activated the same `defineExtension` result
  in every test. Each test now gets a fresh module instance
  (`vi.resetModules()` and dynamic imports), which is "one session per test"
  rather than a weakened assertion. The suite's sixteen tests are otherwise
  unchanged.

  The kit's new command line reads the built bundle directly: `plan --check`
  reports the compiled plan sound, and `manifest` reports package.json and the
  plan agreeing on 1 command and 17 settings.

- `@kkdev92/vscode-ext-kit` `^3.0.0` → `^4.0.0`. The framework raised its own
  `engines.vscode` to `^1.134.0`, which this extension already declares, so the
  two now agree instead of the extension quietly requiring more than the library
  it is built on.

  **The bundle is byte-identical.** Built both ways and compared: the esbuild
  output is the same file down to the byte. The published 3.0.0 and 4.0.0
  packages differ only in `testing/fakes/fake-filewatcher`, which reaches
  callers through the `./testing` subpath and never enters a bundle, and all
  105 `.d.ts` are identical, so there is no API change either.

### Fixed

- **The Marketplace filed this extension under Formatters and Snippets.** It
  contributes neither: the manifest is one command, one keybinding and
  seventeen settings, with no formatting provider and no snippets anywhere in
  it. Browsing either category turned up an image paster. The categories are
  now `AI` and `Other`.

## [0.4.0] - 2026-08-29

### Changed

- **Breaking: VS Code 1.134 or later is now required**, up from 1.125, in step
  with `@types/vscode` moving to `~1.134.0`. The two have to move together —
  `vsce` refuses to package an extension whose `@types/vscode` is newer than its
  `engines.vscode`, which is what the grouped dependency update ran into:
  `@types/vscode ~1.134.0 greater than engines.vscode ^1.125.0`. All six
  per-target builds failed on it. The rule is right, because types above the
  floor let code compile against an API the declared minimum does not have.

  DefinitelyTyped had been stuck at 1.125.0 for months against a stable line
  already past 1.131; it has now caught up to 1.134.0, one release behind the
  current 1.135.

- **The cross-architecture `sharp` binary is taken from the lockfile**, tarball
  and sha512 alike, rather than resolved by version at build time. `linux-arm64`
  and `win32-arm64` need a binary npm will not install on the build host, and
  this is the workflow that publishes — so a hash that does not match now fails
  the build.

- Dev dependencies: `vitest` and `@vitest/coverage-v8` 4.1.10 → 4.1.11, `eslint`
  9.39.2 → 10.9.1 (with `@eslint/js`), `typescript-eslint` 8.66.0 → 8.68.0,
  `mocha` 11.7.5 → 12.0.0-rc.6. `lint` also fails on warnings now.

### Fixed

- **An undocumented environment override is gone.** `CLAUDE_IMG_EXECUTION_POLICY`
  was read and interpolated, unquoted, into the command line that launches
  PowerShell, so a value carrying a shell metacharacter would have run alongside
  it. **This was not remotely exploitable** — setting it means already being able
  to run code as the user — so it is listed as what it was: scaffold residue from
  the first commit, named after something unrelated, with no setting, no
  documentation and no caller. Its only real effect was an unrecorded way to
  lower PowerShell's execution policy. The read is deleted rather than validated,
  and `RemoteSigned` is now a named constant.

- **The paste command no longer stays open until you close its notification.**
  VS Code resolves a notification's promise when the toast is *dismissed*, not
  when it appears, and the command was waiting on that. Nothing looked wrong if
  you pressed the keybinding — but anything invoking `clipshot.pasteImage`
  programmatically, a `runCommands` sequence or another extension, waited on you
  to click. The message itself is unchanged.

## [0.3.2] - 2026-08-09

### Security

- **Updated `sharp` to 0.35.3**, closing GHSA-f88m-g3jw-g9cj — four libvips
  CVEs (2026-33327, -33328, -35590, -35591) that affect every version below
  0.35.0. `sharp` is the only runtime dependency this extension packages, and it
  processes exactly the untrusted input the extension exists to handle: whatever
  image you have on the clipboard. Nothing about the extension's behaviour
  changes.

  The floor is 0.35.3 rather than the patched 0.35.0 because that release ships
  a broken `exports` map that hides its own type declarations from modern
  TypeScript resolution; upstream fixed it in 0.35.1.

## [0.3.1] - 2026-08-08

A packaging release. Nothing in the extension behaves differently — the reason
to publish it is that the Marketplace page renders the README from the published
VSIX, and 0.3.0's was wrong in a way only a reader could see.

### Fixed

- **The Marketplace badge said "retired badge".** shields.io retired the
  `visual-studio-marketplace/v` endpoint. The badge row now matches the other
  extensions in this account, which had already moved.

### Changed

- **TypeScript 5.9 to 6.0.3**, the newest of that line — 7.0.2 is npm's `latest`
  but `typescript-eslint` still caps below 6.1, so 6.0 is the ceiling for
  anything that type-aware-lints. `moduleResolution` moved off the deprecated
  `node10` to `bundler` at the same time, which is the pairing this build
  actually has: esbuild resolves and emits.
- **`tsc` no longer emits.** `compile` is a type check everywhere it is used,
  but it was writing into `dist/` — the directory esbuild writes the bundle to —
  so running it after a build replaced `dist/extension.js` with an unbundled
  copy of one source file.

## [0.3.0] - 2026-08-08

Rebuilt on `@kkdev92/vscode-ext-kit` 3.x. What changed is how the extension
starts and stops, not what it does — every command behaves as it did, and
clipboard access, image processing and path safety were not touched.

### Breaking

- **VS Code 1.125 or later is now required**, up from 1.96. The framework's
  minimum cascades here. Installations on older versions keep 0.2.0 and stop
  receiving updates.
- **`clipshot.logLevel` is a floor again, not the only filter.** 0.2.0 made it
  authoritative on purpose, by choosing a plain output channel. The channel is
  now a `LogOutputChannel`, and VS Code decides what one of those shows — an
  extension cannot raise its own channel's level, so the setting can make the
  log quieter but can no longer turn on output VS Code is already dropping.

  To see `debug` messages, set the level with _Developer: Set Log Level_ and
  pick **ClipShot**. That is a per-channel level, and it persists across
  restarts — set it once when you are chasing something and it stays until you
  change it, without touching the global level or your settings file. In
  exchange the channel gains per-level colouring and the panel's own filter.
  `clipshot.logLevel` is kept because `silent` and "warnings only" are still
  worth asking for.
- **The output channel is named "ClipShot"**, not "clipshot". If you had it
  pinned in the Output panel, select it again.

### Fixed

- **The resize bounds can be cleared.** `clipshot.resize.maxWidth` and
  `clipshot.resize.maxHeight` accept `null`, meaning no limit on that axis, and
  the code has always treated them that way — but they were declared as plain
  integers, so the settings editor refused the value. A feature that shipped and
  could not be reached.
- **Shutdown waits for its own cleanup.** The clipboard handle and any leftover
  temporary file are released asynchronously, and `deactivate()` used to race VS
  Code disposing the extension's subscriptions underneath it. That teardown is
  now owned by the framework and awaited within the shutdown budget.

### Changed

- Activation is one declaration, validated before VS Code is touched: a
  duplicate id or a missing dependency fails at import rather than
  half-registering at runtime.
- The README is rewritten. It had promised the opposite of the log-level
  behaviour above, never named a required VS Code version, and was missing five
  settings from its table.

## [0.2.0] - 2026-07-28

### Fixed

- **`clipshot.logLevel` now works on its own.** Setting it to `debug` or
  `trace` previously appeared to do nothing: the output channel also applied
  VS Code's own log level on top of it, and that level cannot be set by an
  extension, so the messages were filtered out before reaching the panel.
  Running _Developer: Set Log Level_ as a second step is no longer needed.

### Changed

- **Settings are validated when they are read.** A value of the wrong type —
  from a hand-edited `settings.json`, or left over from an older release —
  now falls back to that setting's documented default instead of being passed
  through. Out-of-range numbers keep their existing behavior and are clamped
  into range (a `jpegQuality` of `200` still becomes `100`, not `80`).
- `clipshot.resize.maxWidth` and `clipshot.resize.maxHeight` are now enforced
  as integers, matching how they are declared. A fractional value falls back
  to the default instead of being used.
- The extension package is smaller: 7.73 MB across 97 files, down from
  8.08 MB across 287. A build-time dependency was being shipped alongside the
  bundle that already contained it.

### Internal

- Migrated to `@kkdev92/vscode-ext-kit` 1.1 (from 0.4), moving configuration
  onto a validated schema and consolidating logger, command registration and
  error handling into a single wiring call.
- Extension activation is now covered by unit tests for the first time
  (0% to 95%), raising overall coverage to 89% statements / 77% branches.
- Repaired the end-to-end test harness, which could never run: the npm script
  pointed at an uncompiled path, and the VS Code test host was launched
  against the wrong directory, so the extension was never loaded. It now
  exercises a real VS Code instance in CI-reproducible fashion.
- CI now type-checks both the extension and its tests; previously it ran
  neither.
- Requires Node 22 to build. The published extension is unaffected — it still
  targets the VS Code 1.96 extension host.

## [0.1.13] - 2026-06-13

### Changed

- Cut the number of processes spawned per paste and shortened the clipboard
  pipeline, reducing paste latency.

## [0.1.12] - 2026-02-07

### Changed

- Updated all dependencies to their latest versions.

## [0.1.11] - 2026-02-04

### Changed

- Added marketplace categories to improve discoverability.

## [0.1.10] - 2026-02-04

### Changed

- Project-wide quality pass and an update to `@kkdev92/vscode-ext-kit` 0.2.0.

## [0.1.8] - 2026-02-02

### Added

- Multi-platform VSIX builds, so each platform receives only the native
  binaries it needs.

## [0.1.7] - 2026-02-02

### Fixed

- Bundled the `sharp` dependency correctly in the VSIX; image processing
  failed to load on a clean install without it.

## [0.1.6] - 2026-02-02

### Added

- Image resizing: `clipshot.resize.mode`, `maxWidth`/`maxHeight`, and the
  `ai-optimized` preset for reducing token usage when pasting into AI chats.

## [0.1.5] - 2026-02-01

### Fixed

- Handled PowerShell CLIXML progress messages on Windows, which could be
  mistaken for errors during a clipboard read.

## [0.1.4] - 2026-01-31

### Fixed

- Used the `ImageFormat` object rather than an enum value in the Windows
  PowerShell provider, which failed to resolve on some systems.

## [0.1.3] - 2026-01-31

### Changed

- Documentation updates for the Marketplace listing.

## [0.1.2] - 2026-01-31

### Changed

- Sped up the clipboard paste pipeline.

## [0.1.1] - 2026-01-30

### Added

- Automatic insert-format detection: Markdown files receive `![alt](path)`,
  HTML files receive an `<img>` tag, and everything else receives the path.

## [0.1.0] - 2026-01-30

Initial release.

### Added

- Paste clipboard images straight into the editor with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>
  (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> on macOS), saving the image to
  the workspace and inserting a relative path.
- Windows, macOS and Linux clipboard support.
- Configurable save directory, file name pattern, output format
  (PNG/JPEG/WebP) and quality.
- Path validation and sanitization to keep saved files inside the workspace.

[Unreleased]: https://github.com/kkdev92/clipshot/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/kkdev92/clipshot/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/kkdev92/clipshot/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/kkdev92/clipshot/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/kkdev92/clipshot/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kkdev92/clipshot/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kkdev92/clipshot/compare/v0.1.13...v0.2.0
[0.1.13]: https://github.com/kkdev92/clipshot/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/kkdev92/clipshot/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/kkdev92/clipshot/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/kkdev92/clipshot/compare/v0.1.8...v0.1.10
[0.1.8]: https://github.com/kkdev92/clipshot/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/kkdev92/clipshot/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/kkdev92/clipshot/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/kkdev92/clipshot/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/kkdev92/clipshot/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/kkdev92/clipshot/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/kkdev92/clipshot/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/kkdev92/clipshot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kkdev92/clipshot/releases/tag/v0.1.0
