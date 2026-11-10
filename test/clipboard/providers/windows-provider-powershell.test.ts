/**
 * How the Windows provider starts PowerShell
 *
 * child_process is mocked, so this runs on every platform and never touches the
 * real clipboard: the stand-in records how PowerShell was started and answers
 * the way the clipboard script would.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec, execFile } from 'child_process';
import { writeFileSync } from 'fs';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: vi.fn(), execFile: vi.fn() };
});

import {
  WindowsClipboardProvider,
  CLIPBOARD_SCRIPT,
} from '../../../src/clipboard/providers/windows-provider';
import { ClipboardManager } from '../../../src/clipboard/clipboard-manager';
import { ClipboardError } from '../../../src/core/errors';
import { PNG_SIGNATURE, TIMEOUTS } from '../../../src/core/constants';
import { encodePowerShellCommand } from '../../../src/security/sanitizer';

interface Start {
  file: string;
  args: readonly string[];
  options: { env?: NodeJS.ProcessEnv; timeout?: number; windowsHide?: boolean };
}

type Outcome = { stdout: string; stderr?: string } | Error;
type Done = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

/** Every start of PowerShell is recorded and answered with what `respond` returns. */
function fakePowerShell(respond: (start: Start) => Outcome): Start[] {
  const starts: Start[] = [];
  vi.mocked(execFile).mockImplementation(((
    file: string,
    args: readonly string[],
    options: Start['options'],
    done: Done
  ) => {
    const start = { file, args, options };
    starts.push(start);
    const outcome = respond(start);
    if (outcome instanceof Error) {
      done(outcome);
    } else {
      done(null, { stdout: outcome.stdout, stderr: outcome.stderr ?? '' });
    }
  }) as never);
  return starts;
}

/** What Node reports when the executable is not on the PATH. */
function notFound(file: string): Error {
  return Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' });
}

/** What Node reports when PowerShell ran and exited with an error. */
function failed(file: string): Error {
  return Object.assign(new Error(`Command failed: ${file} -NoLogo`), { code: 1, killed: false });
}

/** What Node reports when the child outlived `timeout` and was ended. */
function timedOut(file: string): Error {
  return Object.assign(new Error(`Command failed: ${file} -NoLogo`), {
    code: null,
    killed: true,
    signal: 'SIGTERM',
  });
}

const TEXT_ONLY = { stdout: '::RESULT::False,True,\r\n' };

describe('WindowsClipboardProvider starting PowerShell', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  let provider: WindowsClipboardProvider;

  beforeEach(() => {
    vi.mocked(execFile).mockReset();
    // Going through a shell is what this provider must not do; if it does,
    // fail at once instead of waiting for a callback that never comes.
    vi.mocked(exec).mockReset();
    vi.mocked(exec).mockImplementation(((command: string, _options: unknown, done: Done) => {
      done(new Error(`started through a shell: ${command}`));
    }) as never);
    provider = new WindowsClipboardProvider();
  });

  afterEach(async () => {
    await provider.cleanup();
    vi.unstubAllEnvs();
    if (platform !== undefined) {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  function onWindows(): void {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  }

  it('starts Windows PowerShell itself, once, with the script as a single argument', async () => {
    const starts = fakePowerShell(() => TEXT_ONLY);

    const data = await provider.getImageData();

    expect(data).toEqual({ hasImage: false, hasText: true, imageBuffer: null, format: null });
    expect(starts).toHaveLength(1);
    expect(starts[0].file).toBe('powershell.exe');
    expect(starts[0].args).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-EncodedCommand',
      encodePowerShellCommand(CLIPBOARD_SCRIPT),
    ]);
    expect(starts[0].options.timeout).toBe(TIMEOUTS.CLIPBOARD_READ);
    expect(starts[0].options.windowsHide).toBe(true);
    expect(exec).not.toHaveBeenCalled();
  });

  it('passes the temporary file in the environment and returns the image written there', async () => {
    vi.stubEnv('CLIPSHOT_TEST_INHERITED', 'kept');
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('pixels')]);
    const starts = fakePowerShell(({ options }) => {
      const target = options.env?.CLIP_TEMP_PATH ?? '';
      writeFileSync(target, png);
      return { stdout: `::RESULT::True,False,${target}\r\n` };
    });

    const data = await provider.getImageData();

    expect(data.hasImage).toBe(true);
    expect(data.format).toBe('png');
    expect(data.imageBuffer?.equals(png)).toBe(true);
    expect(starts[0].options.env?.CLIP_TEMP_PATH).toMatch(/\.png$/);
    // The rest of the environment goes through untouched
    expect(starts[0].options.env?.CLIPSHOT_TEST_INHERITED).toBe('kept');
  });

  it('answers isAvailable() on Windows without starting anything', async () => {
    onWindows();
    const starts = fakePowerShell(() => TEXT_ONLY);

    expect(await provider.isAvailable()).toBe(true);
    expect(starts).toHaveLength(0);
    expect(exec).not.toHaveBeenCalled();
  });

  it('starts one PowerShell for the first paste, the availability check included', async () => {
    onWindows();
    const starts = fakePowerShell(() => TEXT_ONLY);
    const manager = new ClipboardManager(provider);

    await manager.getImageData();

    expect(starts.map((start) => start.file)).toEqual(['powershell.exe']);
    expect(exec).not.toHaveBeenCalled();
  });

  it('keeps using Windows PowerShell for later reads', async () => {
    const starts = fakePowerShell(() => TEXT_ONLY);

    await provider.getImageData();
    await provider.getImageData();

    expect(starts.map((start) => start.file)).toEqual(['powershell.exe', 'powershell.exe']);
  });

  it('falls back to PowerShell 7 when Windows PowerShell is not found, and stays with it', async () => {
    const starts = fakePowerShell(({ file }) =>
      file === 'powershell.exe' ? notFound(file) : TEXT_ONLY
    );

    const first = await provider.getImageData();
    expect(first.hasText).toBe(true);
    expect(starts.map((start) => start.file)).toEqual(['powershell.exe', 'pwsh']);
    expect(starts[1].args).toEqual(starts[0].args);

    await provider.getImageData();
    expect(starts.map((start) => start.file)).toEqual(['powershell.exe', 'pwsh', 'pwsh']);
  });

  it('falls back to PowerShell 7 when Windows PowerShell starts but fails', async () => {
    const starts = fakePowerShell(({ file }) =>
      file === 'powershell.exe' ? failed(file) : TEXT_ONLY
    );

    const data = await provider.getImageData();

    expect(data.hasText).toBe(true);
    expect(starts.map((start) => start.file)).toEqual(['powershell.exe', 'pwsh']);
  });

  it('reports what the PowerShell that ran said when the other one is not installed', async () => {
    fakePowerShell(({ file }) =>
      file === 'powershell.exe'
        ? { stdout: '', stderr: 'Exception calling "GetImage": the clipboard is busy' }
        : notFound(file)
    );

    const failure = await provider.getImageData().then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(ClipboardError);
    expect((failure as ClipboardError).message).toContain('the clipboard is busy');
    expect((failure as ClipboardError).message).not.toContain('ENOENT');
  });

  it('says PowerShell could not be started when neither is found, and looks again next time', async () => {
    let installed = false;
    const starts = fakePowerShell(({ file }) => (installed ? TEXT_ONLY : notFound(file)));

    const failure = await provider.getImageData().then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(ClipboardError);
    expect((failure as ClipboardError).message).toMatch(/PowerShell could not be started/);
    expect((failure as ClipboardError).userMessage).toBe('PowerShell could not be started');
    expect(starts.map((start) => start.file)).toEqual(['powershell.exe', 'pwsh']);

    installed = true;
    await provider.getImageData();
    expect(starts.map((start) => start.file)).toEqual(['powershell.exe', 'pwsh', 'powershell.exe']);
  });

  it('does not start another PowerShell after a timeout', async () => {
    const starts = fakePowerShell(({ file }) => timedOut(file));

    await expect(provider.getImageData()).rejects.toThrow('Clipboard read timed out');
    expect(starts.map((start) => start.file)).toEqual(['powershell.exe']);
  });

  it('accepts the progress record PowerShell writes to stderr on a first run', async () => {
    const progress =
      '#< CLIXML\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
      '<Obj S="progress" RefId="0"><MS><PR N="Record"><T>Completed</T></PR></MS></Obj></Objs>';
    const starts = fakePowerShell(() => ({ ...TEXT_ONLY, stderr: progress }));

    const data = await provider.getImageData();

    expect(data.hasText).toBe(true);
    expect(starts).toHaveLength(1);
  });
});
