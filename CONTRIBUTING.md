# Contributing to ClipShot

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Code of Conduct

Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js 20.x or later
- npm 10.x or later
- VS Code 1.90.0 or later
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

3. Run linting:
   ```bash
   npm run lint
   ```

4. Run tests:
   ```bash
   npm run test
   ```

5. Compile:
   ```bash
   npm run compile
   ```

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
