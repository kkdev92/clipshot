/**
 * E2E test runner for VS Code extension
 * Uses @vscode/test-electron to launch VS Code and run tests
 */

import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json.
    // This file runs compiled, from test/e2e/out/, so the repo root is
    // three levels up.
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

    // The path to the extension test script
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Download VS Code, unzip it and run the integration test
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');

    // Run the extension test
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        // Disable other extensions for faster, isolated tests
        '--disable-extensions',
        // Use a clean user data dir
        '--user-data-dir',
        path.resolve(extensionDevelopmentPath, '.vscode-test/user-data'),
      ],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
