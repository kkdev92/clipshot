import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PathValidationError } from '../../src/core/errors';
import { validatePathInsideWorkspace } from '../../src/security/path-validator';

// A real directory tree rather than mocks: what this function exists for — a
// link that leads out of the workspace — only shows up on a real file system.
// Directory links are junctions, which Windows creates without privileges;
// elsewhere the type argument is ignored.
describe('validatePathInsideWorkspace', () => {
  let root: string;
  let workspace: string;
  let outside: string;
  let linkOut: string;
  let linkedWorkspace: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'clipshot-containment-'));
    workspace = path.join(root, 'workspace');
    outside = path.join(root, 'outside');
    await fs.mkdir(path.join(workspace, 'images'), { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(path.join(workspace, 'images', 'inside.png'), '');
    await fs.writeFile(path.join(outside, 'secret.txt'), '');

    linkOut = path.join(workspace, 'link-out');
    await fs.symlink(outside, linkOut, 'junction');

    linkedWorkspace = path.join(root, 'workspace-link');
    await fs.symlink(workspace, linkedWorkspace, 'junction');
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('inside the workspace', () => {
    it('accepts an existing file', async () => {
      await expect(
        validatePathInsideWorkspace(path.join(workspace, 'images', 'inside.png'), workspace)
      ).resolves.toBe(true);
    });

    it('accepts a file that does not exist yet in an existing folder', async () => {
      await expect(
        validatePathInsideWorkspace(path.join(workspace, 'images', 'new.png'), workspace)
      ).resolves.toBe(true);
    });

    it('accepts folders that do not exist yet, several levels deep', async () => {
      await expect(
        validatePathInsideWorkspace(path.join(workspace, 'new', 'deeper', 'image.png'), workspace)
      ).resolves.toBe(true);
    });

    // A workspace opened through a link (a symlinked home directory, macOS's
    // /var, an 8.3 short name on Windows) resolves to a different string than
    // the path the caller builds from it. The check has to compare real paths
    // on both sides, including for folders that do not exist yet.
    it('accepts new folders under a workspace that is itself reached through a link', async () => {
      await expect(
        validatePathInsideWorkspace(
          path.join(linkedWorkspace, 'new', 'deeper', 'image.png'),
          linkedWorkspace
        )
      ).resolves.toBe(true);
    });
  });

  describe('outside the workspace', () => {
    it('rejects an absolute path outside', async () => {
      await expect(
        validatePathInsideWorkspace(path.join(outside, 'secret.txt'), workspace)
      ).rejects.toBeInstanceOf(PathValidationError);
    });

    it('rejects an existing file reached through a link that leads outside', async () => {
      await expect(
        validatePathInsideWorkspace(path.join(linkOut, 'secret.txt'), workspace)
      ).rejects.toBeInstanceOf(PathValidationError);
    });

    it('rejects a new file directly under a link that leads outside', async () => {
      await expect(
        validatePathInsideWorkspace(path.join(linkOut, 'new.png'), workspace)
      ).rejects.toBeInstanceOf(PathValidationError);
    });

    // The case the folder-creating callers reach: `writeAtomic` and `ensureDir`
    // validate first and then `mkdir -p`, so accepting this would create the
    // folders — and write the image — on the far side of the link.
    it('rejects new folders under a link that leads outside', async () => {
      await expect(
        validatePathInsideWorkspace(path.join(linkOut, 'new', 'deeper', 'image.png'), workspace)
      ).rejects.toBeInstanceOf(PathValidationError);
    });
  });
});
