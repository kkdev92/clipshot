# ClipShot project guide

Start here before taking action in this project. Read the section for your task: [reporting a problem](#reporting-a-problem), [verifying a change](#verifying-a-change), [development instructions](#development-instructions), or [security and private reports](#security-and-private-reports). Consult this guide again if your task changes.

## Reporting a problem

Include the OS, VS Code and extension versions. The clipboard source application and file type help explain platform-specific results. Share a redacted excerpt from **Output → ClipShot** if available.

Include the OS architecture and relevant `clipshot.*` settings. For clipboard problems, select Debug in the ClipShot Output channel and reproduce the issue using a non-sensitive image. Features must work without a network round trip.

## Working on the project

Use the platform-specific setup in the development instructions below when working on clipboard integrations. Setup and verification details appear below.

## Verifying a change

Use the rows that apply to your change when preparing a merge candidate.

| Change | What to check |
| --- | --- |
| Extension behavior | Run `npm run verify` before submission. Report the affected OS and architecture. |
| Clipboard, native dependency or packaging behavior | Follow the platform and packaging checks in the development instructions below. Record the targets tested and distinguish the local E2E results from CI. |
| Capture output | Use a non-sensitive clipboard example and record the output format and observed result. |

See the [shared contribution guidelines](https://github.com/kkdev92/.github/blob/main/CONTRIBUTING.md) for the two pull request options.

## Development instructions

The following development and verification requirements apply when preparing product changes for merge. Reference implementations only need a short description of the idea.

## Getting Started

### Prerequisites

- Node.js 22.12 or later (what CI builds on)
- npm 10.x or later
- VS Code 1.138.0 or later — the minimum the extension declares
- Git

### Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/clipshot.git
   cd clipshot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

4. Open in VS Code:
   ```bash
   code .
   ```

5. Press `F5` to launch the Extension Development Host

## Project Structure

```
src/
├── extension.ts          # Entry point
├── core/                 # Core types and constants
├── config/               # Configuration validation
├── security/             # Security utilities
├── clipboard/            # Clipboard providers
├── image/                # Image processing
├── keyboard/             # Paste handling
└── terminal/             # Keeping the paste key working in the integrated terminal
```

## Development Workflow

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Run the whole gate:
   ```bash
   npm run verify
   ```

   That is lint, both type checks, the unit tests with coverage, and — last —
   the end-to-end suite in a real VS Code.

   The individual lanes are still there (`lint`, `compile`, `typecheck:test`,
   `test`, `test:coverage`, `test:e2e`) and are what you want while iterating.
   `npm run verify` is what to run before pushing.

### Why `test:e2e` matters, and why CI does not run it

**CI runs everything except the end-to-end suite.** It needs a full VS Code
download and a real window per run, which is not free on hosted runners, so it
is deliberately a local step. That makes it the one lane a green PR does not
prove — run it yourself.

It is worth the minute. Two bugs have reached `main` that every unit test
passed through:

- a paste command that never resolved because it awaited its own notification,
  which only shows up when nobody is there to dismiss the toast
- a stale `dist/` making the suite test code that was no longer the source

The first is fixed; the second is why `test:e2e` now bundles before it runs, so
it cannot test a stale build. The first run downloads VS Code (a few hundred MB,
cached in `.vscode-test/`); after that the suite takes about five seconds.

Judge it by the exit code, not by the numbers it prints — a run can say
"11 passing" and still exit 1.

### Commit Messages

Follow conventional commit format:
- `feat: add new feature`
- `fix: fix bug in X`
- `docs: update documentation`
- `refactor: restructure X`
- `test: add tests for X`
- `chore: update dependencies`

## Coding Standards

### TypeScript

- Use strict TypeScript (`strict: true`)
- Prefer explicit types over inference for function parameters and return types
- Use `readonly` for immutable properties
- Avoid `any` - use `unknown` if type is truly unknown

### Security

- Never use string concatenation for shell commands
- Always validate user input
- Use `realpath()` for path validation
- Escape or encode all external inputs

### Error Handling

- Use custom error classes from `core/errors.ts`
- Include user-friendly messages
- Log technical details for debugging

### Testing

- Write unit tests for all new functionality
- Include both positive and negative test cases
- Test edge cases and error conditions

## Adding Platform Support

To add support for a new platform:

1. Create a new provider in `src/clipboard/providers/`
2. Implement the `IClipboardProvider` interface
3. Add platform detection in `clipboard-manager.ts`
4. Add appropriate tests
5. Update documentation

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Security and private reports

Follow this project’s private reporting instructions below. If its reporting form is unavailable and no other project contact is listed, use the [shared private contact](https://github.com/kkdev92/.github/blob/main/SECURITY.md#private-contact).

## Supported Versions

| Version         | Supported          |
| --------------- | ------------------ |
| Latest release  | :white_check_mark: |
| Older releases  | :x:                |

Fixes ship in a new release rather than as patches to earlier versions.

## Reporting a Vulnerability

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Open a private report:
   <https://github.com/kkdev92/clipshot/security/advisories/new>

   That is the **Report a vulnerability** button in the repository's Security
   tab; the link goes straight to it. Private reporting is enabled, so the
   advisory stays between us until there is a fix to describe.

## Security Measures

This extension implements the following security measures:

### Command Injection Prevention

All shell commands are executed using:
- **Base64 Encoding** for PowerShell (`-EncodedCommand`)
- **Proper Escaping** for Unix shells
- **Environment Variables** for parameter passing

```typescript
// Safe PowerShell execution: a constant script, started without a shell
const encoded = encodePowerShellCommand(script);
execFile('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded]);
```

### Path Traversal Prevention

- The saved image, and every folder created for it, is checked to be inside the workspace before it is written
- `realpath()` resolves symbolic links in the part of the path that already exists, so a link cannot lead the image outside the workspace
- A save directory that leads outside the workspace, through `..` or otherwise, is refused when the image is saved. One whose `..` stays inside the workspace resolves to the folder it names

```typescript
// Path validation (src/security/path-validator.ts, simplified)
const realRoot = await fs.realpath(workspaceRoot);
const realTarget = await resolveExistingPrefix(targetPath, workspaceRoot);
const relative = path.relative(realRoot, realTarget);
if (relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new PathValidationError('Path is outside the workspace');
}
```

### Secure Temporary Files

- Cryptographically random file names (`crypto.randomBytes`)
- Exclusive file creation (`O_EXCL` flag)
- Automatic cleanup
- Restricted permissions (`0o600`)

### Input Validation

Settings are checked each time they are read:
- Numeric values are clamped to valid ranges, and a value of the wrong type falls back to the default
- A save directory that is absolute or contains `..`, and a file name pattern with shell metacharacters, are reported as configuration warnings in the ClipShot log. They are not what keeps writes inside the workspace; the check above is
- Each generated file name has control characters, and the characters a Windows file name cannot hold (`< > : " / \ | ? *`), removed. On Windows, a reserved name such as `CON` is prefixed

### Workspace Trust

The extension requires a trusted workspace and will not operate in untrusted workspaces.

## Security Considerations for Users

1. **Review Save Directory**: Ensure `saveDirectory` is set to a reasonable location
2. **Check File Permissions**: Saved images have standard permissions
3. **Network Access**: This extension does not make any network requests
4. **Clipboard Access**: The extension only reads clipboard data when you explicitly trigger the paste command

## Known Limitations

- On Windows, PowerShell execution is required for clipboard access
- The extension cannot validate the content of images for malicious data
- Symbolic link resolution depends on filesystem support
