# ClipShot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.90+-blue.svg)](https://code.visualstudio.com/)

Paste clipboard images into your workspace — then automatically insert a relative path at your cursor.
Great for markdown docs, notes, and AI chats.
*Built for fast docs — paste once, keep writing.*

> **Status:** Active (best-effort maintenance)

---

## Table of Contents

- [Why ClipShot](#why-clipshot)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Configuration](#configuration)
- [Platform Requirements](#platform-requirements)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Support & Maintenance Policy](#support--maintenance-policy)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Why ClipShot

Pasting images into documentation often takes a few manual steps (save → name → move → link).  
ClipShot keeps it simple: **paste → saved → path inserted**.

---

## Features

- **Smart Paste**: Press `Ctrl+Shift+V` (or `Cmd+Shift+V` on macOS) to paste clipboard images
- **Non-intrusive**: Uses a dedicated shortcut to avoid conflicts with standard paste
- **Automatic Saving**: Images are saved to a configurable directory in your workspace
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Multiple Formats**: Supports PNG, JPEG, and WebP output formats
- **Secure by Design**: Prevents command injection and path traversal attacks
- **Configurable**: File naming, output format, quality settings, insertion format, and more

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
npm run compile
npm run package
```

---

## Quick Start

1. Copy an image to your clipboard (e.g., take a screenshot)
2. Place your cursor where you want the image path to appear
3. Press `Ctrl+Shift+V` (or `Cmd+Shift+V` on macOS)
4. ClipShot saves the image and inserts its relative path

You can also use the Command Palette: `ClipShot: Paste Image`

---

## Usage

ClipShot saves the clipboard image into your workspace and inserts a reference at the cursor.

By default (`auto` mode), ClipShot detects the file type and uses the appropriate format:

- **Markdown files** → `![filename](relative/path.png)`
- **HTML files** → `<img src="relative/path.png" alt="filename" />`
- **Other files** → `relative/path.png`

---

## Configuration

| Setting                       | Default                                           | Description                             |
| ----------------------------- | ------------------------------------------------- | --------------------------------------- |
| `clipshot.enabled`            | `true`                                            | Enable/disable the extension            |
| `clipshot.saveDirectory`      | `.clipshot`                                       | Directory to save images                |
| `clipshot.fileName.pattern`   | `image_${yyyy}${MM}${dd}_${HH}${mm}${ss}_${seq3}` | File name pattern                       |
| `clipshot.output.format`      | `png`                                             | Output format (png/jpeg/webp)           |
| `clipshot.output.jpegQuality` | `80`                                              | JPEG quality (1-100)                    |
| `clipshot.output.webpQuality` | `80`                                              | WebP quality (1-100)                    |
| `clipshot.insert.format`      | `auto`                                            | Insert format (auto/path/markdown/html) |

### File Name Pattern Tokens

- `${yyyy}` - 4-digit year
- `${MM}` - 2-digit month
- `${dd}` - 2-digit day
- `${HH}` - 2-digit hour
- `${mm}` - 2-digit minute
- `${ss}` - 2-digit second
- `${seq3}` - 3-digit sequence number

---

## Platform Requirements

### Windows

- Windows 10/11 (x64 or ARM64)
- PowerShell 5.1 or PowerShell 7

### macOS

- macOS 10.15 or later
- Intel or Apple Silicon

### Linux

- X11: `xclip` package required
- Wayland: `wl-clipboard` package required

---

## Security

This extension is designed with security as a priority:

- **No Command Injection**: All shell commands use Base64 encoding or proper escaping
- **Path Validation**: Prevents path traversal attacks with realpath validation
- **Secure Temp Files**: Uses cryptographically random file names
- **Workspace Isolation**: Files can only be saved within the workspace

For security concerns, please see [SECURITY.md](SECURITY.md).

---

## Troubleshooting

### Windows

- **PowerShell execution policy error**: Run VS Code as administrator or adjust your execution policy
- **No image detected**: Ensure the clipboard has image data (try taking a fresh screenshot)

### macOS

- **Permission denied**: Grant VS Code terminal access in System Preferences > Security & Privacy > Privacy > Accessibility

### Linux

- **No clipboard tool found**: Install `xclip` (X11) or `wl-clipboard` (Wayland)

  ```bash
  # X11
  sudo apt install xclip

  # Wayland
  sudo apt install wl-clipboard
  ```

- **Empty image**: Some apps copy images in unsupported formats. Try copying from a different source.

### General

- **Image not saved**: Check that a workspace folder is open
- **Path not inserted**: Ensure the cursor is in an editable area

---

## Contributing

Contributions are welcome — thank you for helping make ClipShot better 🙌
Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

If you’re planning a larger change, opening an issue first is appreciated (it helps align direction and avoids duplicate work).

---

## Support & Maintenance Policy

ClipShot is a personal hobby project maintained in spare time.
I’ll do my best to review issues and PRs, but responses and releases may be a bit slow sometimes — thank you for your patience.

Helpful things when reporting bugs:

- OS / VS Code version
- Your ClipShot settings (only what’s relevant)
- Steps to reproduce + expected/actual behavior

Security-related reports should follow [SECURITY.md](SECURITY.md).
Really appreciate you using ClipShot 💛

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- Image processing powered by [Sharp](https://sharp.pixelplumbing.com/)

For third-party license details, see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
