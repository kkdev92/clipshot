/**
 * Linux clipboard tool discovery, when the tool is installed after a paste
 *
 * child_process is mocked, so this runs on every platform: `which` fails for
 * every tool until xclip is "installed".
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { exec } from 'child_process';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: vi.fn() };
});

import { LinuxClipboardProvider } from '../../../src/clipboard/providers/linux-provider';
import { ClipboardManager } from '../../../src/clipboard/clipboard-manager';

type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

describe('LinuxClipboardProvider tool discovery', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('finds xclip installed after a check that found no tool, without a reload', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'x11');
    vi.stubEnv('DISPLAY', ':0');
    vi.stubEnv('WAYLAND_DISPLAY', '');
    let installed = false;
    vi.mocked(exec).mockImplementation(((command: string, _options: unknown, callback: ExecCallback) => {
      if (installed && command === 'which xclip') {
        callback(null, { stdout: '/usr/bin/xclip\n', stderr: '' });
      } else {
        callback(new Error(`${command}: not found`));
      }
    }) as never);
    const provider = new LinuxClipboardProvider();
    const manager = new ClipboardManager(provider);

    expect(await manager.isAvailable()).toBe(false);

    installed = true;
    expect(await manager.isAvailable()).toBe(true);
    expect(provider.getClipboardTool()).toBe('xclip');
  });
});
