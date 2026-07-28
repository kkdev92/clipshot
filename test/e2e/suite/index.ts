/**
 * E2E test suite entry point
 * Configures and runs Mocha tests within VS Code
 */

import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    // The e2e specs use suite()/test(), which is Mocha's TDD interface.
    ui: 'tdd',
    color: true,
    timeout: 60000, // 60 second timeout for E2E tests
  });

  const testsRoot = path.resolve(__dirname, '.');

  // Find all test files
  const files = await glob('**/*.e2e.test.js', { cwd: testsRoot });

  // Add files to the test suite
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise((resolve, reject) => {
    try {
      // Run the mocha test
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
