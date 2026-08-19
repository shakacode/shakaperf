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
import { captureWorkingTreePatch, importPatchFile } from '../patch-capture';
import { BisectPatchRegistry } from '../patch-registry';

describe('bisect patch registry', () => {
  let rootDir: string;
  let repoDir: string;
  let registry: BisectPatchRegistry;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-patch-registry-'));
    repoDir = path.join(rootDir, 'repo');
    fs.mkdirSync(repoDir);
    git(['init', '--initial-branch=main']);
    git(['config', 'user.email', 'patches@example.com']);
    git(['config', 'user.name', 'Patch Tests']);
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'before\n');
    git(['add', 'app.txt']);
    git(['commit', '-m', 'initial']);
    registry = new BisectPatchRegistry({ configDirectory: rootDir, repoDir });
  });

  afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  it('creates, lists, and loads a hash-verified registration', () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const captured = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);

    const created = registry.create('compat', captured, {
      kind: 'build', appliesTo: { all: true }, purpose: '',
    });

    expect(created.entry).toMatchObject({ id: 'compat', kind: 'build', appliesTo: { all: true } });
    expect(created.entry).not.toHaveProperty('purpose');
    expect(created.hashValid).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });

  it('updates metadata without changing bytes and edits bytes without changing metadata', () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'version one\n');
    const first = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);
    registry.create('compat', first, { kind: 'build', appliesTo: { all: true } });

    const beforeBytes = fs.readFileSync(path.join(rootDir, 'bisect-repairs', 'compat.patch'));
    registry.updateMetadata('compat', {
      kind: 'test-harness', purpose: 'new purpose', appliesTo: { commits: ['HEAD'] },
    });
    expect(fs.readFileSync(path.join(rootDir, 'bisect-repairs', 'compat.patch')).equals(beforeBytes))
      .toBe(true);

    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'version two\n');
    const second = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);
    const edited = registry.edit('compat', second);
    expect(edited.entry).toMatchObject({
      kind: 'test-harness', purpose: 'new purpose', appliesTo: { commits: ['HEAD'] },
    });
    expect(edited.entry.sha256).not.toBe(first.sha256);
  });

  it('applies, checks, reverses, and recognizes native committed content', () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const captured = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);
    registry.create('compat', captured, { kind: 'build', appliesTo: { all: true } });

    expect(registry.apply('compat', { check: true })).toBe('applicable');
    expect(registry.apply('compat')).toBe('applied');
    expect(fs.readFileSync(path.join(repoDir, 'app.txt'), 'utf8')).toBe('after\n');
    expect(registry.apply('compat', { reverse: true })).toBe('reversed');
    expect(git(['status', '--porcelain'])).toBe('');

    registry.apply('compat');
    git(['add', 'app.txt']);
    git(['commit', '-m', 'native change']);
    expect(registry.apply('compat')).toBe('already-native');
  });

  it('removes the registration and optionally retains the artifact', () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const captured = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);
    registry.create('compat', captured, { kind: 'build', appliesTo: { all: true } });
    registry.remove('compat', true);
    expect(registry.list()).toEqual([]);
    expect(fs.existsSync(path.join(rootDir, 'bisect-repairs', 'compat.patch'))).toBe(true);
  });

  it('refuses hash-mismatched artifacts', () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const captured = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);
    registry.create('compat', captured, { kind: 'build', appliesTo: { all: true } });
    fs.appendFileSync(path.join(rootDir, 'bisect-repairs', 'compat.patch'), '\n');
    expect(registry.get('compat').hashValid).toBe(false);
    expect(() => registry.apply('compat')).toThrow(/hash/i);
  });

  it('preserves the old artifact and manifest when edited bytes fail verification', () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const captured = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);
    registry.create('compat', captured, { kind: 'build', appliesTo: { all: true } });
    const artifact = path.join(rootDir, 'bisect-repairs', 'compat.patch');
    const manifest = path.join(rootDir, 'bisect-repairs', 'manifest.json');
    const artifactBefore = fs.readFileSync(artifact);
    const manifestBefore = fs.readFileSync(manifest);
    const invalidPath = path.join(rootDir, 'invalid.patch');
    fs.writeFileSync(invalidPath, [
      'diff --git a/app.txt b/app.txt',
      '--- a/app.txt',
      '+++ b/app.txt',
      '@@ -1 +1 @@',
      '-different base',
      '+replacement',
      '',
    ].join('\n'));
    const invalid = importPatchFile({ repoDir, patchFile: invalidPath });

    expect(() => registry.edit('compat', invalid)).toThrow(/does not apply cleanly/i);
    expect(fs.readFileSync(artifact).equals(artifactBefore)).toBe(true);
    expect(fs.readFileSync(manifest).equals(manifestBefore)).toBe(true);
  });

  it('verifies a selector in disposable worktrees without touching the active checkout', () => {
    const goodSha = git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const captured = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);
    fs.writeFileSync(path.join(repoDir, 'unrelated.txt'), 'middle\n');
    git(['add', 'unrelated.txt']);
    git(['commit', '-m', 'middle']);
    const middleSha = git(['rev-parse', 'HEAD']);
    registry.create('compat', captured, { kind: 'build', appliesTo: { all: true } });

    const results = registry.verify('compat', { goodRef: goodSha, badRef: middleSha });

    expect(results).toEqual([
      { sha: goodSha, outcome: 'applies' },
      { sha: middleSha, outcome: 'applies' },
    ]);
    expect(git(['status', '--porcelain'])).toBe('');
    expect(git(['worktree', 'list', '--porcelain']).match(/worktree /g)).toHaveLength(1);
  });

  it('requires a range when the configured verification scope cannot be enumerated alone', () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const captured = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);
    registry.create('all', captured, { kind: 'build', appliesTo: { all: true } });
    registry.create('session-start', captured, {
      kind: 'build', appliesTo: { through: 'HEAD' },
    });

    expect(() => registry.verify('all')).toThrow(/requires good-ref and bad-ref/i);
    expect(() => registry.verify('session-start')).toThrow(/requires good-ref and bad-ref/i);
  });

  it('verifies every exact commit even when supplied range excludes one', () => {
    const goodSha = git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const captured = captureWorkingTreePatch({ repoDir, paths: ['app.txt'] });
    git(['restore', 'app.txt']);
    fs.writeFileSync(path.join(repoDir, 'middle.txt'), 'middle\n');
    git(['add', 'middle.txt']);
    git(['commit', '-m', 'middle']);
    const middleSha = git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repoDir, 'later.txt'), 'later\n');
    git(['add', 'later.txt']);
    git(['commit', '-m', 'later']);
    const laterSha = git(['rev-parse', 'HEAD']);
    registry.create('exact', captured, {
      kind: 'build', appliesTo: { commits: [goodSha, laterSha] },
    });

    expect(registry.verify('exact', { goodRef: goodSha, badRef: middleSha }))
      .toEqual([
        { sha: goodSha, outcome: 'applies' },
        { sha: laterSha, outcome: 'applies' },
      ]);
  });

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
  }
});
