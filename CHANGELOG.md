# Changelog

All notable changes to the ClipShot extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
