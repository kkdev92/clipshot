import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**'],
    setupFiles: ['./test/setup.ts'],
    server: {
      deps: {
        // The kit imports 'vscode' itself, so it has to go through Vite's
        // transform for the module mock in test/setup.ts to reach it.
        inline: ['@kkdev92/vscode-ext-kit'],
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/core/types.ts',
        // Platform-specific providers depend on external tools (PowerShell, xclip, osascript)
        // that cannot be tested without mocking entire child_process module
        'src/clipboard/providers/**',
      ],
      thresholds: {
        lines: 80,
        branches: 74,
        functions: 80,
        statements: 80,
      },
    },
  },
});
