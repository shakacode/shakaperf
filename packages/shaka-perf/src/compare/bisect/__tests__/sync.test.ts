/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { BuildManifest } from '../../../twin-servers/helpers/rebuild-check';
import { reconcileExperimentVolume, syncCommitDelta } from '../sync';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(rootDir: string, relativePath: string, contents: string): void {
  const destination = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents, 'utf8');
}

function manifest(files: string[]): BuildManifest {
  return { version: 1, dockerignore: '', copySources: null, files };
}

describe('bisect experiment volume synchronization', () => {
  let rootDir: string;
  let sourceDir: string;
  let volumeDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-sync-'));
    sourceDir = path.join(rootDir, 'source');
    volumeDir = path.join(rootDir, 'volume');
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(volumeDir);
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('reconciles only manifest-owned paths and preserves generated files', async () => {
    write(sourceDir, 'current.txt', 'current');
    write(sourceDir, 'nested/script.sh', '#!/bin/sh\necho current\n');
    fs.chmodSync(path.join(sourceDir, 'nested/script.sh'), 0o755);
    write(volumeDir, 'current.txt', 'stale');
    write(volumeDir, 'stale.txt', 'remove me');
    write(volumeDir, 'generated/cache.json', 'preserve me');

    await reconcileExperimentVolume({
      sourceDir,
      volumeDir,
      manifest: manifest(['current.txt', 'nested/script.sh', 'stale.txt']),
      candidateSha: 'candidate-sha',
    });

    expect(fs.readFileSync(path.join(volumeDir, 'current.txt'), 'utf8')).toBe('current');
    expect(fs.readFileSync(path.join(volumeDir, 'nested/script.sh'), 'utf8'))
      .toBe('#!/bin/sh\necho current\n');
    expect(fs.statSync(path.join(volumeDir, 'nested/script.sh')).mode & 0o111).not.toBe(0);
    expect(fs.existsSync(path.join(volumeDir, 'stale.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(volumeDir, 'generated/cache.json'), 'utf8'))
      .toBe('preserve me');
    expect(JSON.parse(fs.readFileSync(
      path.join(volumeDir, '.shaka-bisect-materialized.json'),
      'utf8',
    ))).toEqual({ sha: 'candidate-sha' });
  });

  it('applies add, modify, rename, delete, type, and executable-mode changes', async () => {
    git(sourceDir, ['init', '--initial-branch=main']);
    git(sourceDir, ['config', 'user.email', 'bisect@example.com']);
    git(sourceDir, ['config', 'user.name', 'Bisect Test']);
    write(sourceDir, 'modified.txt', 'before');
    write(sourceDir, 'renamed-from.txt', 'rename contents');
    write(sourceDir, 'deleted.txt', 'delete contents');
    write(sourceDir, 'script.sh', '#!/bin/sh\necho test\n');
    write(sourceDir, 'typed.txt', 'regular file');
    git(sourceDir, ['add', '.']);
    git(sourceDir, ['commit', '-m', 'previous']);
    const previousSha = git(sourceDir, ['rev-parse', 'HEAD']);

    fs.cpSync(sourceDir, volumeDir, {
      recursive: true,
      filter: (source) => path.basename(source) !== '.git',
    });
    write(volumeDir, 'generated/cache.json', 'preserve me');

    write(sourceDir, 'added.txt', 'added');
    write(sourceDir, 'modified.txt', 'after');
    git(sourceDir, ['mv', 'renamed-from.txt', 'renamed-to.txt']);
    fs.rmSync(path.join(sourceDir, 'deleted.txt'));
    fs.chmodSync(path.join(sourceDir, 'script.sh'), 0o755);
    fs.rmSync(path.join(sourceDir, 'typed.txt'));
    fs.symlinkSync('modified.txt', path.join(sourceDir, 'typed.txt'));
    git(sourceDir, ['add', '-A']);
    git(sourceDir, ['commit', '-m', 'candidate']);
    const candidateSha = git(sourceDir, ['rev-parse', 'HEAD']);

    await syncCommitDelta({
      sourceDir,
      volumeDir,
      manifest: manifest([
        'added.txt',
        'modified.txt',
        'renamed-from.txt',
        'renamed-to.txt',
        'deleted.txt',
        'script.sh',
        'typed.txt',
      ]),
      previousSha,
      candidateSha,
    });

    expect(fs.readFileSync(path.join(volumeDir, 'added.txt'), 'utf8')).toBe('added');
    expect(fs.readFileSync(path.join(volumeDir, 'modified.txt'), 'utf8')).toBe('after');
    expect(fs.existsSync(path.join(volumeDir, 'renamed-from.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(volumeDir, 'renamed-to.txt'), 'utf8'))
      .toBe('rename contents');
    expect(fs.existsSync(path.join(volumeDir, 'deleted.txt'))).toBe(false);
    expect(fs.statSync(path.join(volumeDir, 'script.sh')).mode & 0o111).not.toBe(0);
    expect(fs.lstatSync(path.join(volumeDir, 'typed.txt')).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(path.join(volumeDir, 'typed.txt'))).toBe('modified.txt');
    expect(fs.readFileSync(path.join(volumeDir, 'generated/cache.json'), 'utf8'))
      .toBe('preserve me');
    expect(JSON.parse(fs.readFileSync(
      path.join(volumeDir, '.shaka-bisect-materialized.json'),
      'utf8',
    ))).toEqual({ sha: candidateSha });
  });

  it('ignores changed paths that are not owned by the manifest', async () => {
    git(sourceDir, ['init', '--initial-branch=main']);
    git(sourceDir, ['config', 'user.email', 'bisect@example.com']);
    git(sourceDir, ['config', 'user.name', 'Bisect Test']);
    write(sourceDir, 'owned.txt', 'before');
    write(sourceDir, 'ignored.txt', 'source before');
    git(sourceDir, ['add', '.']);
    git(sourceDir, ['commit', '-m', 'previous']);
    const previousSha = git(sourceDir, ['rev-parse', 'HEAD']);
    write(volumeDir, 'owned.txt', 'before');
    write(volumeDir, 'ignored.txt', 'generated value');

    write(sourceDir, 'owned.txt', 'after');
    write(sourceDir, 'ignored.txt', 'source after');
    git(sourceDir, ['add', '.']);
    git(sourceDir, ['commit', '-m', 'candidate']);
    const candidateSha = git(sourceDir, ['rev-parse', 'HEAD']);

    await syncCommitDelta({
      sourceDir,
      volumeDir,
      manifest: manifest(['owned.txt']),
      previousSha,
      candidateSha,
    });

    expect(fs.readFileSync(path.join(volumeDir, 'owned.txt'), 'utf8')).toBe('after');
    expect(fs.readFileSync(path.join(volumeDir, 'ignored.txt'), 'utf8'))
      .toBe('generated value');
  });

  it('rejects manifest paths that traverse outside either root', async () => {
    const outsidePath = path.join(rootDir, 'outside.txt');
    write(rootDir, 'outside.txt', 'outside');

    await expect(reconcileExperimentVolume({
      sourceDir,
      volumeDir,
      manifest: manifest(['../outside.txt']),
      candidateSha: 'candidate-sha',
    })).rejects.toThrow(/outside/i);
    expect(fs.readFileSync(outsidePath, 'utf8')).toBe('outside');
  });

  it('rejects source paths that escape through a symlinked directory', async () => {
    const outsideDir = path.join(rootDir, 'outside-source');
    fs.mkdirSync(outsideDir);
    write(outsideDir, 'owned.txt', 'outside');
    fs.symlinkSync(outsideDir, path.join(sourceDir, 'escape'));

    await expect(reconcileExperimentVolume({
      sourceDir,
      volumeDir,
      manifest: manifest(['escape/owned.txt']),
      candidateSha: 'candidate-sha',
    })).rejects.toThrow(/outside/i);
    expect(fs.existsSync(path.join(volumeDir, 'escape/owned.txt'))).toBe(false);
  });

  it('rejects volume paths that escape through a symlinked directory', async () => {
    const outsideDir = path.join(rootDir, 'outside-volume');
    fs.mkdirSync(outsideDir);
    write(sourceDir, 'escape/owned.txt', 'source');
    fs.symlinkSync(outsideDir, path.join(volumeDir, 'escape'));

    await expect(reconcileExperimentVolume({
      sourceDir,
      volumeDir,
      manifest: manifest(['escape/owned.txt']),
      candidateSha: 'candidate-sha',
    })).rejects.toThrow(/outside/i);
    expect(fs.existsSync(path.join(outsideDir, 'owned.txt'))).toBe(false);
  });
});
