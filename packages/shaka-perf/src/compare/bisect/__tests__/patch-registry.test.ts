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
import { captureWorkingTreePatch } from '../patch-capture';
import { BisectPatchRegistry } from '../patch-registry';

describe('compare-bisect patch registry', () => {
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

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
  }
});
