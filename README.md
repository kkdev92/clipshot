# ClipShot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/kkdev92/clipshot/actions/workflows/ci.yml/badge.svg)](https://github.com/kkdev92/clipshot/actions/workflows/ci.yml)
[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/kkdev92.clipshot.svg)](https://marketplace.visualstudio.com/items?itemName=kkdev92.clipshot)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/14051/badge)](https://www.bestpractices.dev/projects/14051)

Paste a clipboard image into your workspace and get a relative path at the cursor — one keystroke, no save dialog, no file manager.
Images are processed on your machine and are never uploaded anywhere.
*Built for fast docs — paste once, keep writing.*

> **Status:** Active (best-effort maintenance)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Why ClipShot](#why-clipshot)
- [Usage](#usage)
- [Known Limitations](#known-limitations)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [Security and Privacy](#security-and-privacy)
- [Platform Requirements](#platform-requirements)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [Support & Maintenance Policy](#support--maintenance-policy)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Features

- **One Keystroke**: `Ctrl+Shift+V` (`Cmd+Shift+V` on macOS) saves the clipboard image and inserts a path at the cursor
- **Non-Intrusive**: A dedicated shortcut, so ordinary paste keeps working exactly as it did
- **Format Aware**: Markdown gets `![alt](path)`, HTML gets `<img …>`, everything else gets the bare path
- **Resizing**: Fit images within bounds, or use the `ai-optimized` preset to cut the tokens an image costs in a chat
- **Output Formats**: PNG, JPEG or WebP, with quality settings for the lossy two
- **Cross-Platform**: Windows, macOS and Linux, on x64 and ARM64
- **Local by Design**: No network requests, no telemetry — the image never leaves your machine
- **Safe Paths**: Saves are confined to the workspace, resolved through `realpath` so a symlink cannot escape it

---

## Installation

### Install from VS Code Marketplace (recommended)

- Open the Extensions view (`Ctrl+Shift+X`)
- Search for **ClipShot**
- Click **Install**

You can also open the Marketplace page directly:

- <https://marketplace.visualstudio.com/items?itemName=kkdev92.clipshot>

### Build from Source (for contributors)

> If you just want to use ClipShot, installing from the Marketplace is the easiest option.

```bash
git clone https://github.com/kkdev92/clipshot.git
cd clipshot
npm install
npm run package
```

---

## Quick Start

1. Copy an image to the clipboard — a screenshot, or **Copy Image** from a browser
2. Put the cursor where the path should go
3. Press `Ctrl+Shift+V` (`Cmd+Shift+V` on macOS)
4. The image is saved under `.clipshot/` and its relative path is inserted

`ClipShot: Paste Image` in the Command Palette does the same thing.

---

## Why ClipShot

Getting a screenshot into a document is usually four steps that have nothing to
do with writing: save it somewhere, give it a name, move it next to the
document, then type the link. Each one is small and none of them is the thing
you were doing.

ClipShot collapses that into the paste. The file lands in your workspace with a
timestamped name, and the reference appears at the cursor in whatever form the
file you are editing wants.

Everything happens on your machine. That matters for the case this was built
for — internal design docs and notes that should not be uploaded to a service
just to end up in a document.

---

## Usage

The inserted reference depends on the file you are editing, in `auto` mode:

- **Markdown** → `![filename](relative/path.png)`
- **HTML** → `<img src="relative/path.png" alt="filename" />`
- **Anything else** → `relative/path.png`

Set `clipshot.insert.format` to `path`, `markdown` or `html` to pin one instead.
`clipshot.insert.altSource` decides what the alt text says: the file name, or
the fixed string in `clipshot.insert.altLiteral`.

If no editor has focus, the path goes to the clipboard instead and the
notification says so — the image is still saved.

### File Name Pattern Tokens

`clipshot.fileName.pattern` accepts:

| Token | Meaning |
| --- | --- |
| `${yyyy}` | 4-digit year |
| `${MM}` | 2-digit month |
| `${dd}` | 2-digit day |
| `${HH}` | 2-digit hour |
| `${mm}` | 2-digit minute |
| `${ss}` | 2-digit second |
| `${seq3}` | Sequence number, `clipshot.fileName.sequenceDigits` wide |

### Resizing

`clipshot.resize.mode` is `off` by default. Set it to `fit` and images are
scaled to fit within the bounds while keeping their aspect ratio. Images
already smaller than the bounds are left alone — nothing is ever upscaled.

```jsonc
// Fit within a custom box
{
  "clipshot.resize.mode": "fit",
  "clipshot.resize.maxWidth": 800,
  "clipshot.resize.maxHeight": 600
}
```

Either bound can be `null`, meaning "no limit on this axis" — clear the field in
the settings editor and the other dimension scales freely.

```jsonc
// Cap the width at 800, let the height be whatever it needs to be
{
  "clipshot.resize.mode": "fit",
  "clipshot.resize.maxWidth": 800,
  "clipshot.resize.maxHeight": null
}
```

`clipshot.resize.preset` overrides both bounds when set. `ai-optimized` caps at
1200×1200, which is the useful one for pasting into a chat where image size
becomes token cost.

```jsonc
{
  "clipshot.resize.mode": "fit",
  "clipshot.resize.preset": "ai-optimized"
}
```

---

## Known Limitations

- **A workspace folder must be open.** There is nowhere to save the image otherwise, and the extension says so rather than picking a directory for you
- **Trusted workspaces only.** ClipShot writes files, which is not something to do in a window you have told VS Code not to trust
- **Resizing needs the bundled `sharp` binary.** If it fails to load on your platform, the paste still works — the image is saved at its original size and the output channel says why
- **The clipboard is read through a platform tool** (see [How It Works](#how-it-works)); an application that puts an image on the clipboard in an unusual format may not be recognised
- **One paste at a time.** A second paste while one is in flight is declined rather than queued

---

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `clipshot.enabled` | `true` | Enable or disable the extension |
| `clipshot.logLevel` | `info` | Floor for the *ClipShot* output channel. VS Code's own log level applies first — see [Troubleshooting](#troubleshooting) |
| `clipshot.saveDirectory` | `.clipshot` | Where images go, relative to the workspace root |
| `clipshot.fileName.pattern` | `image_${yyyy}${MM}${dd}_${HH}${mm}${ss}_${seq3}` | File name pattern |
| `clipshot.fileName.sequenceDigits` | `3` | Width of `${seq3}`, 1–6 |
| `clipshot.output.format` | `png` | `png` / `jpeg` / `webp` |
| `clipshot.output.jpegQuality` | `80` | JPEG quality, 1–100 |
| `clipshot.output.webpQuality` | `80` | WebP quality, 1–100 |
| `clipshot.resize.mode` | `off` | `off` / `fit` |
| `clipshot.resize.maxWidth` | `1200` | Width bound in pixels, 1–16384, or `null` for no limit |
| `clipshot.resize.maxHeight` | `1200` | Height bound in pixels, 1–16384, or `null` for no limit |
| `clipshot.resize.preset` | `null` | `ai-optimized` caps at 1200×1200 and overrides both bounds |
| `clipshot.insert.format` | `auto` | `auto` / `path` / `markdown` / `html` |
| `clipshot.insert.altSource` | `filename` | `filename` / `literal` |
| `clipshot.insert.altLiteral` | `image` | Alt text when `altSource` is `literal` |
| `clipshot.limits.maxFileSizeMB` | `10` | Largest image to save, 1–100 MB |
| `clipshot.notifications.level` | `all` | `all` / `errors` / `none` |

A value outside its documented range is clamped rather than rejected: a
`jpegQuality` of `200` becomes `100`, not the default. The output channel says
what happened.

---

## How It Works

VS Code's extension API has no way to read an image off the clipboard —
`env.clipboard` is text only. So ClipShot asks the operating system, through the
tool each platform provides:

| Platform | Tool |
| --- | --- |
| Windows | PowerShell (`Get-Clipboard`, via .NET's clipboard API) |
| macOS | `pngpaste` when installed, otherwise `osascript` and NSPasteboard |
| Linux | `wl-paste` on Wayland, `xclip` on X11 — whichever is present |

The image arrives as bytes, is written to a temporary file with a
cryptographically random name, processed by [Sharp](https://sharp.pixelplumbing.com/)
if resizing or a format change is called for, and moved into place under
`clipshot.saveDirectory`. The temporary file is removed whether the paste
succeeds or not.

Activation, settings, logging and shutdown are handled by
[@kkdev92/vscode-ext-kit](https://github.com/kkdev92/vscode-ext-kit): the
extension declares what it contributes and the framework validates that
declaration before VS Code is touched, then owns the single path back out —
including the asynchronous cleanup of the clipboard handle and any temporary
file still on disk.

---

## Security and Privacy

ClipShot handles data that is often confidential — screenshots of internal
tools, of code, of documents — so the design keeps it local.

- **No Network**: The extension makes no network requests and contains no networking code. Nothing about the image is uploaded, and there is nothing to opt out of
- **No Telemetry**: No usage data is collected
- **Nothing Variable On A Command Line**: The clipboard scripts are constants — Base64-encoded and passed as `-EncodedCommand` on Windows, single-quote escaped on macOS. The one value that changes per paste, the temporary file path, travels in an environment variable, so there is no string for it to be injected into. Where a tool does take a variable argument it is invoked with an argument array rather than a shell string
- **Path Confinement**: The destination is resolved with `realpath` and checked to be inside the workspace, so neither a crafted file-name pattern nor a symlink can write outside it
- **Random Temporary Names**: Temporary files use 16 bytes from `crypto.randomBytes`, and are removed on both the success and failure paths
- **Size Limit**: An image larger than `clipshot.limits.maxFileSizeMB` is refused before it is written
- **Trusted Workspaces Only**: The extension declares that it needs a trusted workspace, because it writes files into one

Worth being explicit about the limits: spawning a platform clipboard tool means
trusting that tool and the PATH it is found on, and confining writes to the
workspace is a check against mistakes and crafted inputs, not an OS-level
sandbox.

CI builds a VSIX for each of the six supported targets, unpacks it, checks that
the `sharp` native binary that target needs is inside, and loads the module to
confirm it works.

For the full policy and for vulnerability reporting, see [SECURITY.md](SECURITY.md).

---

## Platform Requirements

- **VS Code 1.134 or later**
- Windows, macOS or Linux, on x64 or ARM64

| Platform | Needs |
| --- | --- |
| Windows | Windows 10/11. PowerShell 5.1 or 7 — 5.1 ships with Windows |
| macOS | macOS 10.15 or later. Nothing to install; `pngpaste` is used if you have it, and makes pasting faster |
| Linux | `wl-clipboard` on Wayland, or `xclip` on X11 |

ClipShot is published as a separate VSIX per target — `win32-x64`,
`win32-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64` — so the
one you install carries only your own platform's image-processing binary
instead of all six. VS Code picks the right one for you.

CI runs the test suite on Windows, macOS and Linux, and builds and verifies all
six.

> **Upgrading?** The minimum VS Code version is now 1.134 — it was 1.125 from
> 0.3.0, and 1.96 before that. Older installations keep the version they have
> and stop receiving updates.

---

## Troubleshooting

### Any Platform

- **"No workspace folder open"**: ClipShot saves into the workspace, so it needs one. Open a folder and try again
- **Path not inserted, but the image was saved**: There was no editor focused. The path was copied to the clipboard instead — press `Ctrl+V`
- **Images are not being resized**: Check `clipshot.resize.mode` is `fit`, then check the output channel — if the bundled `sharp` binary failed to load, resizing is skipped and the reason is logged
- **Need more detail in the logs**: Open **View → Output → ClipShot**, then set the level in the panel's own dropdown or via `Developer: Set Log Level`. `clipshot.logLevel` is a *floor* on top of that: it can make the log quieter, but it cannot turn on output that VS Code's level is already filtering out

### Windows

- **PowerShell execution policy error**: The clipboard read runs a PowerShell command. Adjust your execution policy, or run VS Code from a shell where it is permitted
- **No image detected**: Make sure the clipboard actually holds image data — copying a *file* in Explorer is not the same as copying an image

### macOS

- **Permission denied**: Grant VS Code access under System Settings → Privacy & Security → Accessibility
- **Pasting feels slow**: `osascript` is the fallback and pays a startup cost per paste. `brew install pngpaste` removes it

### Linux

- **No clipboard tool found**: Install the one for your session

  ```bash
  # Wayland
  sudo apt install wl-clipboard

  # X11
  sudo apt install xclip
  ```

- **Empty image**: Some applications put images on the clipboard in a format the tool does not offer as PNG. Try copying from a different source

---

## Changelog

Release notes are in [CHANGELOG.md](CHANGELOG.md).

---

## Contributing

Contributions are welcome — thank you for helping make ClipShot better 🙌
Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

If you're planning a larger change, opening an issue first is appreciated (it helps align direction and avoids duplicate work). Note that anything requiring a network round trip is out of scope by design.

---

## Support & Maintenance Policy

ClipShot is a personal hobby project maintained in spare time.
The project is active, but support is best-effort: I'll do my best to review issues and PRs, and releases may be a bit slow sometimes — thank you for your patience.

Helpful things when reporting bugs:

- OS / architecture / VS Code version
- The relevant `clipshot.*` settings
- Output from **View → Output → ClipShot** with the level set to `debug`
- What you copied, and from which application

Security-related reports should follow [SECURITY.md](SECURITY.md).
Really appreciate you using ClipShot 💛

---

## License

ClipShot is licensed under the MIT License — see [LICENSE](LICENSE).

Copyright and licence notices for the third-party code shipped inside the VSIX are collected in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

---

## Acknowledgments

- Image processing by [Sharp](https://sharp.pixelplumbing.com/), and libvips beneath it
- Extension framework by [@kkdev92/vscode-ext-kit](https://github.com/kkdev92/vscode-ext-kit)
- Faster macOS clipboard reads, when installed, by [pngpaste](https://github.com/jcsalterego/pngpaste)
