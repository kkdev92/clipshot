# Contributing to ClipShot

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Code of Conduct

Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js 22.12 or later (what CI builds on)
- npm 10.x or later
- VS Code 1.134.0 or later — the minimum the extension declares
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
└── keyboard/             # Paste handling
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

### Pull Requests

1. Ensure all tests pass
2. Update documentation if needed
3. Add a clear description of changes
4. Reference any related issues

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

## Reporting Issues

When reporting issues, please include:

- VS Code version
- Extension version
- Operating system and version
- Steps to reproduce
- Expected vs actual behavior
- Any error messages

## Feature Requests

Feature requests are welcome! Please:

1. Check existing issues first
2. Describe the use case
3. Explain why it would be valuable

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
