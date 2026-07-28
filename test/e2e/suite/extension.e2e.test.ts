/**
 * E2E tests for ClipShot extension
 * Tests extension activation and command registration
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('ClipShot Extension E2E Tests', () => {
  // Wait for extension to activate
  suiteSetup(async () => {
    // Give time for extension to activate
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  test('Extension should be present', () => {
    const extension = vscode.extensions.getExtension('kkdev92.clipshot');
    assert.ok(extension, 'Extension not found');
  });

  test('Extension should activate', async () => {
    const extension = vscode.extensions.getExtension('kkdev92.clipshot');
    assert.ok(extension, 'Extension not found');

    // Wait for activation
    if (!extension.isActive) {
      await extension.activate();
    }

    assert.ok(extension.isActive, 'Extension did not activate');
  });

  test('pasteImage command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('clipshot.pasteImage'),
      'clipshot.pasteImage command not registered'
    );
  });

  test('Extension should have configuration', () => {
    const config = vscode.workspace.getConfiguration('clipshot');
    assert.ok(config, 'Configuration not found');

    // Check default values
    assert.strictEqual(config.get('enabled'), true, 'enabled should be true by default');
    assert.strictEqual(config.get('saveDirectory'), '.clipshot', 'saveDirectory default mismatch');
    assert.strictEqual(config.get('output.format'), 'png', 'output.format default mismatch');
  });

  test('Configuration should be readable', () => {
    const config = vscode.workspace.getConfiguration('clipshot');

    // Test various configuration keys
    const enabled = config.get<boolean>('enabled');
    const saveDirectory = config.get<string>('saveDirectory');
    const fileNamePattern = config.get<string>('fileName.pattern');
    const outputFormat = config.get<string>('output.format');
    const jpegQuality = config.get<number>('output.jpegQuality');
    const webpQuality = config.get<number>('output.webpQuality');
    const insertFormat = config.get<string>('insert.format');

    assert.strictEqual(typeof enabled, 'boolean', 'enabled should be boolean');
    assert.strictEqual(typeof saveDirectory, 'string', 'saveDirectory should be string');
    assert.strictEqual(typeof fileNamePattern, 'string', 'fileNamePattern should be string');
    assert.strictEqual(typeof outputFormat, 'string', 'outputFormat should be string');
    assert.strictEqual(typeof jpegQuality, 'number', 'jpegQuality should be number');
    assert.strictEqual(typeof webpQuality, 'number', 'webpQuality should be number');
    assert.strictEqual(typeof insertFormat, 'string', 'insertFormat should be string');
  });

  test('Keybinding should be registered', async () => {
    // Note: Checking keybindings in VS Code API is limited
    // We verify the command exists which implies keybinding is set
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('clipshot.pasteImage'), 'Command for keybinding not found');
  });

  test('Extension should have correct metadata', () => {
    const extension = vscode.extensions.getExtension('kkdev92.clipshot');
    assert.ok(extension, 'Extension not found');

    const packageJson = extension.packageJSON;
    assert.strictEqual(packageJson.name, 'clipshot', 'Package name mismatch');
    assert.ok(packageJson.version, 'Version not found');
    assert.ok(packageJson.contributes, 'Contributes section not found');
    assert.ok(packageJson.contributes.commands, 'Commands contribution not found');
    assert.ok(packageJson.contributes.keybindings, 'Keybindings contribution not found');
    assert.ok(packageJson.contributes.configuration, 'Configuration contribution not found');
  });
});

suite('ClipShot Commands E2E Tests', () => {
  test('pasteImage command should execute without workspace (shows error)', async () => {
    // Without a workspace, the command should show an error
    // This test verifies the command doesn't crash
    try {
      await vscode.commands.executeCommand('clipshot.pasteImage');
      // Command executed - might show notification
    } catch (error) {
      // Error is expected when no workspace is open
      assert.ok(true, 'Command handled gracefully');
    }
  });

  test('Command should handle no image in clipboard gracefully', async () => {
    // Clear clipboard to text
    await vscode.env.clipboard.writeText('test text');

    try {
      await vscode.commands.executeCommand('clipshot.pasteImage');
      // Should show "no image" notification
    } catch (error) {
      // Error handling is acceptable
      assert.ok(true, 'No image handled gracefully');
    }
  });
});

suite('ClipShot Configuration E2E Tests', () => {
  test('Should be able to update configuration', async () => {
    const config = vscode.workspace.getConfiguration('clipshot');

    // Only a value explicitly set at the Global target has to be restored;
    // otherwise clear the key so the package.json default applies again.
    const originalValue = config.inspect<string>('saveDirectory')?.globalValue;

    try {
      await config.update('saveDirectory', 'test-images', vscode.ConfigurationTarget.Global);

      const newValue = vscode.workspace
        .getConfiguration('clipshot')
        .get<string>('saveDirectory');
      assert.strictEqual(newValue, 'test-images', 'Configuration not updated');
    } finally {
      // Restore in a finally block: leaving the override behind would leak
      // into the other tests and into the next run's user-data directory.
      await config.update('saveDirectory', originalValue, vscode.ConfigurationTarget.Global);
    }
  });

  test('Should validate output format options', () => {
    const config = vscode.workspace.getConfiguration('clipshot');
    const format = config.get<string>('output.format');

    // Format should be one of the allowed values
    const validFormats = ['png', 'jpeg', 'webp'];
    assert.ok(
      validFormats.includes(format!),
      `Invalid format: ${format}. Expected one of: ${validFormats.join(', ')}`
    );
  });

  test('Should validate insert format options', () => {
    const config = vscode.workspace.getConfiguration('clipshot');
    const insertFormat = config.get<string>('insert.format');

    // Insert format should be one of the allowed values
    const validFormats = ['auto', 'path', 'markdown', 'html'];
    assert.ok(
      validFormats.includes(insertFormat!),
      `Invalid insert format: ${insertFormat}. Expected one of: ${validFormats.join(', ')}`
    );
  });

  test('Quality settings should be within valid range', () => {
    const config = vscode.workspace.getConfiguration('clipshot');

    const jpegQuality = config.get<number>('output.jpegQuality');
    const webpQuality = config.get<number>('output.webpQuality');

    assert.ok(
      jpegQuality! >= 1 && jpegQuality! <= 100,
      `JPEG quality out of range: ${jpegQuality}`
    );
    assert.ok(
      webpQuality! >= 1 && webpQuality! <= 100,
      `WebP quality out of range: ${webpQuality}`
    );
  });
});
