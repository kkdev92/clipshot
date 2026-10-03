# Security Policy

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
// Safe PowerShell execution
const encoded = encodePowerShellCommand(script);
const cmd = `powershell.exe -EncodedCommand ${encoded}`;
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
