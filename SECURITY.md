# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Use GitHub's "Report a vulnerability" feature in the Security tab

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

- All paths are validated to be within the workspace
- `realpath()` is used to resolve symbolic links
- Parent directory references (`..`) are blocked

```typescript
// Path validation
const realTarget = await fs.realpath(targetPath);
const relative = path.relative(workspaceRoot, realTarget);
if (relative.startsWith('..')) {
  throw new PathValidationError('Path is outside workspace');
}
```

### Secure Temporary Files

- Cryptographically random file names (`crypto.randomBytes`)
- Exclusive file creation (`O_EXCL` flag)
- Automatic cleanup
- Restricted permissions (`0o600`)

### Input Validation

All user-configurable values are validated:
- Save directory cannot be absolute or contain `..`
- File name patterns cannot contain shell metacharacters
- Numeric values are clamped to valid ranges

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
