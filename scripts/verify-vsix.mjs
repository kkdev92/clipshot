/**
 * VSIX Dependency Verification Script
 *
 * Verifies that all dependencies listed in package.json are properly
 * included in the VSIX package. This prevents runtime errors due to
 * missing modules.
 *
 * Features:
 * - Automatically reads dependencies from package.json
 * - Verifies bundleDependencies matches dependencies
 * - Checks all required modules exist in VSIX
 * - Tests sharp module can be loaded
 *
 * Run after `npm run package` to validate the VSIX before publishing.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Platform-specific sharp binaries (at least one should exist)
const PLATFORM_BINARIES = [
  'node_modules/@img/sharp-win32-x64',
  'node_modules/@img/sharp-win32-arm64',
  'node_modules/@img/sharp-linux-x64',
  'node_modules/@img/sharp-linux-arm64',
  'node_modules/@img/sharp-darwin-x64',
  'node_modules/@img/sharp-darwin-arm64',
];

// Known transitive dependencies that must be included
// Add entries here for dependencies that have important transitive deps
const TRANSITIVE_DEPS = {
  sharp: ['detect-libc'],
};

function loadPackageJson() {
  const pkgPath = join(projectRoot, 'package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf-8'));
}

function findVsixFile() {
  const files = readdirSync(projectRoot).filter(f => f.endsWith('.vsix'));
  if (files.length === 0) {
    throw new Error('No .vsix file found. Run "npm run package" first.');
  }
  // Return the first one (usually there's only one)
  return join(projectRoot, files[0]);
}

function extractVsix(vsixPath, extractDir) {
  console.log(`Extracting ${vsixPath}...`);

  // Clean up previous extraction
  if (existsSync(extractDir)) {
    rmSync(extractDir, { recursive: true });
  }
  mkdirSync(extractDir, { recursive: true });

  // VSIX is a ZIP file - use platform-appropriate unzip
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    execSync(`powershell -Command "Expand-Archive -Path '${vsixPath}' -DestinationPath '${extractDir}' -Force"`, {
      stdio: 'pipe',
    });
  } else {
    execSync(`unzip -q "${vsixPath}" -d "${extractDir}"`, {
      stdio: 'pipe',
    });
  }
}

function verifyBundleDependencies(pkg) {
  console.log('\nVerifying bundleDependencies configuration...\n');

  const dependencies = Object.keys(pkg.dependencies || {});
  const bundleDeps = pkg.bundleDependencies || [];
  const errors = [];

  // Check that all dependencies are in bundleDependencies
  for (const dep of dependencies) {
    if (bundleDeps.includes(dep)) {
      console.log(`  ✓ ${dep} is in bundleDependencies`);
    } else {
      console.log(`  ✗ ${dep} is NOT in bundleDependencies`);
      errors.push(`Dependency "${dep}" must be added to bundleDependencies in package.json`);
    }
  }

  return errors;
}

function verifyModulesInVsix(extractDir, pkg) {
  const extensionDir = join(extractDir, 'extension');
  const errors = [];

  console.log('\nVerifying modules in VSIX...\n');

  // Get all dependencies to check
  const dependencies = Object.keys(pkg.dependencies || {});

  // Also add known transitive dependencies
  const allDeps = new Set(dependencies);
  for (const [dep, transitive] of Object.entries(TRANSITIVE_DEPS)) {
    if (dependencies.includes(dep)) {
      transitive.forEach(t => allDeps.add(t));
    }
  }

  // Check each dependency exists
  for (const dep of allDeps) {
    const modulePath = join(extensionDir, 'node_modules', dep);
    if (existsSync(modulePath)) {
      console.log(`  ✓ ${dep}`);
    } else {
      console.log(`  ✗ ${dep}: MISSING`);
      errors.push(`Missing module in VSIX: ${dep}`);
    }
  }

  // Check platform binaries for sharp
  if (dependencies.includes('sharp')) {
    console.log('\nVerifying sharp platform binaries...\n');
    const foundBinaries = [];
    for (const binaryPath of PLATFORM_BINARIES) {
      const fullPath = join(extensionDir, binaryPath);
      if (existsSync(fullPath)) {
        console.log(`  ✓ ${binaryPath}`);
        foundBinaries.push(binaryPath);
      }
    }

    if (foundBinaries.length === 0) {
      errors.push('No platform-specific sharp binaries found (@img/sharp-*)');
      console.log('  ✗ No platform binaries found');
    } else {
      console.log(`\n  Found ${foundBinaries.length} platform binary package(s)`);
    }
  }

  return errors;
}

function testSharpLoad(extractDir) {
  console.log('\nTesting sharp module load...\n');

  const extensionDir = join(extractDir, 'extension');
  const sharpPath = join(extensionDir, 'node_modules/sharp');

  if (!existsSync(sharpPath)) {
    return { success: false, error: 'sharp module not found' };
  }

  try {
    // Try to require sharp from the extracted location
    // This tests if all dependencies are present
    const testScript = `
      process.chdir('${extensionDir.replace(/\\/g, '\\\\')}');
      require('${sharpPath.replace(/\\/g, '\\\\')}');
      console.log('sharp loaded successfully');
    `;

    execSync(`node -e "${testScript}"`, {
      stdio: 'pipe',
      cwd: extensionDir,
    });

    console.log('  ✓ sharp module loads successfully');
    return { success: true };
  } catch (error) {
    const errorMessage = error.stderr?.toString() || error.message;
    console.log('  ✗ sharp module failed to load');
    console.log(`    Error: ${errorMessage.split('\n')[0]}`);
    return { success: false, error: errorMessage };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('VSIX Dependency Verification');
  console.log('='.repeat(60));

  const extractDir = join(projectRoot, '.vsix-verify-temp');
  const allErrors = [];

  try {
    // Load package.json
    const pkg = loadPackageJson();
    console.log(`\nPackage: ${pkg.name}@${pkg.version}`);
    console.log(`Dependencies: ${Object.keys(pkg.dependencies || {}).join(', ')}`);

    // Step 1: Verify bundleDependencies configuration
    const configErrors = verifyBundleDependencies(pkg);
    allErrors.push(...configErrors);

    // Step 2: Find and extract VSIX
    const vsixPath = findVsixFile();
    console.log(`\nFound VSIX: ${vsixPath}`);
    extractVsix(vsixPath, extractDir);

    // Step 3: Verify modules in VSIX
    const moduleErrors = verifyModulesInVsix(extractDir, pkg);
    allErrors.push(...moduleErrors);

    // Step 4: Test sharp load (if sharp is a dependency)
    if (Object.keys(pkg.dependencies || {}).includes('sharp')) {
      const loadResult = testSharpLoad(extractDir);
      if (!loadResult.success) {
        allErrors.push(`sharp load test failed: ${loadResult.error}`);
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    if (allErrors.length > 0) {
      console.log('\nErrors:');
      allErrors.forEach(e => console.log(`  ✗ ${e}`));
      console.log('\n❌ VSIX verification FAILED');
      console.log('\nTo fix:');
      console.log('  1. Ensure all dependencies are listed in bundleDependencies');
      console.log('  2. Run "npm run package" again');
      console.log('  3. Run "npm run verify:vsix" to re-verify\n');
      process.exit(1);
    }

    console.log('\n✅ VSIX verification PASSED\n');
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Verification failed: ${error.message}\n`);
    process.exit(1);
  } finally {
    // Cleanup
    if (existsSync(extractDir)) {
      rmSync(extractDir, { recursive: true });
    }
  }
}

main();
