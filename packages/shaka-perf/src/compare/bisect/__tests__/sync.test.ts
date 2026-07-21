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
import * as shell from '../../../twin-servers/helpers/shell';
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
    jest.restoreAllMocks();
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
      path.join(volumeDir, '.shaka-bisect-synced-candidate.json'),
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
      path.join(volumeDir, '.shaka-bisect-synced-candidate.json'),
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

  it('rejects an internal destination alias before deleting generated content', async () => {
    write(volumeDir, 'generated/cache.json', 'preserve me');
    fs.symlinkSync('generated', path.join(volumeDir, 'owned'));

    await expect(reconcileExperimentVolume({
      sourceDir,
      volumeDir,
      manifest: manifest(['owned/cache.json']),
      candidateSha: 'candidate-sha',
    })).rejects.toThrow(/symlink/i);
    expect(fs.readFileSync(path.join(volumeDir, 'generated/cache.json'), 'utf8'))
      .toBe('preserve me');
  });

  it('preserves a valid dangling tracked symlink', async () => {
    fs.mkdirSync(path.join(sourceDir, 'links'));
    fs.symlinkSync('../missing/file.txt', path.join(sourceDir, 'links/dangling'));

    await reconcileExperimentVolume({
      sourceDir,
      volumeDir,
      manifest: manifest(['links/dangling']),
      candidateSha: 'candidate-sha',
    });

    const copiedLink = path.join(volumeDir, 'links/dangling');
    expect(fs.lstatSync(copiedLink).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(copiedLink)).toBe('../missing/file.txt');
  });

  it('rejects a copied symlink whose destination target ancestor is a symlink', async () => {
    const outsideDir = path.join(rootDir, 'outside-target');
    fs.mkdirSync(outsideDir);
    write(sourceDir, 'generated/cache.json', 'source');
    fs.mkdirSync(path.join(sourceDir, 'links'));
    fs.symlinkSync('../generated/cache.json', path.join(sourceDir, 'links/owned-link'));
    fs.symlinkSync(outsideDir, path.join(volumeDir, 'generated'));

    await expect(reconcileExperimentVolume({
      sourceDir,
      volumeDir,
      manifest: manifest(['links/owned-link']),
      candidateSha: 'candidate-sha',
    })).rejects.toThrow(/symlink/i);
    expect(fs.existsSync(path.join(volumeDir, 'links/owned-link'))).toBe(false);
  });

  const itPosix = process.platform === 'win32' ? it.skip : it;

  itPosix('keeps backslashes distinct and parses NUL-delimited unusual filenames', async () => {
    const backslashPath = 'owned\\file.txt';
    const slashPath = 'owned/file.txt';
    const controlCharacterPath = 'line\nand\tfile.txt';
    git(sourceDir, ['init', '--initial-branch=main']);
    git(sourceDir, ['config', 'user.email', 'bisect@example.com']);
    git(sourceDir, ['config', 'user.name', 'Bisect Test']);
    write(sourceDir, backslashPath, 'backslash before');
    write(sourceDir, slashPath, 'slash before');
    write(sourceDir, controlCharacterPath, 'control before');
    git(sourceDir, ['add', '-A']);
    git(sourceDir, ['commit', '-m', 'previous']);
    const previousSha = git(sourceDir, ['rev-parse', 'HEAD']);
    write(volumeDir, backslashPath, 'backslash before');
    write(volumeDir, slashPath, 'generated slash value');
    write(volumeDir, controlCharacterPath, 'control before');

    write(sourceDir, backslashPath, 'backslash after');
    write(sourceDir, slashPath, 'slash after');
    write(sourceDir, controlCharacterPath, 'control after');
    git(sourceDir, ['add', '-A']);
    git(sourceDir, ['commit', '-m', 'candidate']);
    const candidateSha = git(sourceDir, ['rev-parse', 'HEAD']);

    await syncCommitDelta({
      sourceDir,
      volumeDir,
      manifest: manifest([backslashPath, controlCharacterPath]),
      previousSha,
      candidateSha,
    });

    expect(fs.readFileSync(path.join(volumeDir, backslashPath), 'utf8'))
      .toBe('backslash after');
    expect(fs.readFileSync(path.join(volumeDir, slashPath), 'utf8'))
      .toBe('generated slash value');
    expect(fs.readFileSync(path.join(volumeDir, controlCharacterPath), 'utf8'))
      .toBe('control after');
  });

  it('detects a real copy status and copies the destination without removing its source', async () => {
    git(sourceDir, ['init', '--initial-branch=main']);
    git(sourceDir, ['config', 'user.email', 'bisect@example.com']);
    git(sourceDir, ['config', 'user.name', 'Bisect Test']);
    write(sourceDir, 'original.txt', 'shared contents');
    git(sourceDir, ['add', '-A']);
    git(sourceDir, ['commit', '-m', 'previous']);
    const previousSha = git(sourceDir, ['rev-parse', 'HEAD']);
    write(volumeDir, 'original.txt', 'shared contents');

    fs.copyFileSync(path.join(sourceDir, 'original.txt'), path.join(sourceDir, 'copied.txt'));
    git(sourceDir, ['add', '-A']);
    git(sourceDir, ['commit', '-m', 'candidate']);
    const candidateSha = git(sourceDir, ['rev-parse', 'HEAD']);
    const copyStatus = execFileSync('git', [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      '--find-copies-harder',
      previousSha,
      candidateSha,
    ], { cwd: sourceDir, encoding: 'utf8' });
    expect(copyStatus.split('\0')).toEqual(['C100', 'original.txt', 'copied.txt', '']);
    const execSpy = jest.spyOn(shell, 'exec');

    await syncCommitDelta({
      sourceDir,
      volumeDir,
      manifest: manifest(['original.txt', 'copied.txt']),
      previousSha,
      candidateSha,
    });

    const diffCall = execSpy.mock.calls.find(([command, args]) =>
      command === 'git' && args[0] === 'diff');
    expect(diffCall?.[1]).toEqual([
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      '--find-copies-harder',
      previousSha,
      candidateSha,
    ]);
    expect(fs.readFileSync(path.join(volumeDir, 'original.txt'), 'utf8'))
      .toBe('shared contents');
    expect(fs.readFileSync(path.join(volumeDir, 'copied.txt'), 'utf8'))
      .toBe('shared contents');
  });

  it('rejects deleting a non-empty directory at an owned file path without writing marker', async () => {
    const markerPath = path.join(volumeDir, '.shaka-bisect-synced-candidate.json');
    write(volumeDir, 'owned.txt/generated/cache.json', 'preserve me');

    await expect(reconcileExperimentVolume({
      sourceDir,
      volumeDir,
      manifest: manifest(['owned.txt']),
      candidateSha: 'candidate-sha',
    })).rejects.toThrow(/non-empty directory/i);

    expect(fs.readFileSync(path.join(volumeDir, 'owned.txt/generated/cache.json'), 'utf8'))
      .toBe('preserve me');
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it('rejects replacing a non-empty directory at an owned file path without advancing marker', async () => {
    const markerPath = path.join(volumeDir, '.shaka-bisect-synced-candidate.json');
    write(sourceDir, 'owned.txt', 'candidate contents');
    write(volumeDir, 'owned.txt/generated/cache.json', 'preserve me');
    fs.writeFileSync(markerPath, JSON.stringify({ sha: 'previous-sha' }), 'utf8');

    await expect(reconcileExperimentVolume({
      sourceDir,
      volumeDir,
      manifest: manifest(['owned.txt']),
      candidateSha: 'candidate-sha',
    })).rejects.toThrow(/non-empty directory/i);

    expect(fs.readFileSync(path.join(volumeDir, 'owned.txt/generated/cache.json'), 'utf8'))
      .toBe('preserve me');
    expect(JSON.parse(fs.readFileSync(markerPath, 'utf8'))).toEqual({ sha: 'previous-sha' });
  });
});
