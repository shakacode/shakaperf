/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  captureSourceCommitPatch,
  captureWorkingTreePatch,
  importPatchFile,
} from '../patch-capture';

describe('compare-bisect patch capture', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-patch-capture-'));
    git(['init', '--initial-branch=main']);
    git(['config', 'user.email', 'patches@example.com']);
    git(['config', 'user.name', 'Patch Tests']);
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'original\n');
    git(['add', 'tracked.txt']);
    git(['commit', '-m', 'initial']);
  });

  afterEach(() => fs.rmSync(repoDir, { recursive: true, force: true }));

  it('captures staged, unstaged, and untracked work without changing the real index', () => {
    fs.writeFileSync(path.join(repoDir, 'staged.txt'), 'staged\n');
    git(['add', 'staged.txt']);
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'changed\n');
    fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'untracked\n');
    const indexBefore = git(['diff', '--cached', '--binary']);

    const captured = captureWorkingTreePatch({ repoDir, allFiles: true });

    expect(captured.files.map((file) => file.path).sort()).toEqual([
      'staged.txt', 'tracked.txt', 'untracked.txt',
    ]);
    expect(captured.source).toMatchObject({ kind: 'working-tree' });
    expect(git(['diff', '--cached', '--binary'])).toBe(indexBefore);
  });

  it('requires explicit working-tree scope and excludes ignored result artifacts', () => {
    expect(() => captureWorkingTreePatch({ repoDir })).toThrow(/pathspecs.*all-files/i);
    fs.mkdirSync(path.join(repoDir, 'compare-results'));
    fs.writeFileSync(path.join(repoDir, 'compare-results', 'report.json'), '{}');
    expect(() => captureWorkingTreePatch({ repoDir, allFiles: true }))
      .toThrow(/capture is empty/i);
  });

  it('honors configured copy-ignore folders for working-tree and commit capture', () => {
    fs.mkdirSync(path.join(repoDir, 'generated'));
    fs.writeFileSync(path.join(repoDir, 'generated', 'cache.txt'), 'ignored\n');
    fs.writeFileSync(path.join(repoDir, 'kept.txt'), 'kept\n');
    const copyIgnore = { folders: ['generated'], files: [] };

    expect(captureWorkingTreePatch({ repoDir, allFiles: true, copyIgnore }).files)
      .toEqual([{ path: 'kept.txt', added: 1, deleted: 0 }]);

    git(['add', 'generated/cache.txt', 'kept.txt']);
    git(['commit', '-m', 'generated and kept']);
    expect(captureSourceCommitPatch({ repoDir, ref: 'HEAD', copyIgnore }).files)
      .toEqual([{ path: 'kept.txt', added: 1, deleted: 0 }]);
  });

  it('captures a source commit and records immutable provenance', () => {
    fs.writeFileSync(path.join(repoDir, 'added.txt'), 'added\n');
    git(['add', 'added.txt']);
    git(['commit', '-m', 'add source']);
    const sha = git(['rev-parse', 'HEAD']);
    const parentSha = git(['rev-parse', 'HEAD^']);

    const captured = captureSourceCommitPatch({ repoDir, ref: 'HEAD', paths: ['added.txt'] });

    expect(captured.files).toEqual([{ path: 'added.txt', added: 1, deleted: 0 }]);
    expect(captured.source).toEqual({
      kind: 'source-commit', sha, parentSha, paths: ['added.txt'],
    });
  });

  it('requires --root for root commits', () => {
    const root = git(['rev-list', '--max-parents=0', 'HEAD']);
    expect(() => captureSourceCommitPatch({ repoDir, ref: root })).toThrow(/root.*--root/i);
    expect(captureSourceCommitPatch({ repoDir, ref: root, root: true }).files)
      .toEqual([{ path: 'tracked.txt', added: 1, deleted: 0 }]);
  });

  it('imports exact patch bytes and rejects unsafe targets', () => {
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'changed\n');
    const validPath = path.join(repoDir, 'valid.patch');
    fs.writeFileSync(validPath, execFileSync('git', ['diff', '--binary', '--full-index'], { cwd: repoDir }));
    const captured = importPatchFile({ repoDir, patchFile: validPath });
    expect(captured.bytes.equals(fs.readFileSync(validPath))).toBe(true);
    expect(captured.source).toEqual({ kind: 'patch-file', importedFromBasename: 'valid.patch' });

    const unsafePath = path.join(repoDir, 'unsafe.patch');
    fs.writeFileSync(unsafePath, [
      'diff --git a/compare-results/report.json b/compare-results/report.json',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/compare-results/report.json',
      '@@ -0,0 +1 @@',
      '+{}',
      '',
    ].join('\n'));
    expect(() => importPatchFile({ repoDir, patchFile: unsafePath })).toThrow(/forbidden/i);
  });

  it('rejects imported patches targeting configured copy-ignore files', () => {
    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'changed\n');
    const patchFile = path.join(repoDir, 'configured-ignore.patch');
    fs.writeFileSync(patchFile, execFileSync('git', ['diff', '--binary', '--full-index'], { cwd: repoDir }));
    expect(() => importPatchFile({
      repoDir,
      patchFile,
      copyIgnore: { folders: [], files: ['tracked.txt'] },
    })).toThrow(/configured copy-ignore/i);
  });

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
  }
});
