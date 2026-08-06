/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getChangedFiles, getGitRootDirectory } from '../helpers/git';
import { defaultCopyIgnoreConfig } from '../copy-ignore-defaults';
import * as shell from '../helpers/shell';

jest.mock('../helpers/shell');
const mockExecSync = shell.execSync_ as jest.MockedFunction<typeof shell.execSync_>;

describe('getChangedFiles', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns changed and untracked files combined', () => {
    mockExecSync
      .mockReturnValueOnce('file1.ts\nfile2.ts') // git diff
      .mockReturnValueOnce('file3.ts') // git diff --cached
      .mockReturnValueOnce('file4.ts'); // untracked

    const files = getChangedFiles('/repo', defaultCopyIgnoreConfig());

    expect(files).toEqual(['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts']);
  });

  it('deduplicates files appearing in both outputs', () => {
    mockExecSync
      .mockReturnValueOnce('shared.ts\nonly-diff.ts')
      .mockReturnValueOnce('shared.ts\nonly-staged.ts')
      .mockReturnValueOnce('shared.ts\nonly-untracked.ts');

    const files = getChangedFiles('/repo', defaultCopyIgnoreConfig());

    expect(files).toEqual(['shared.ts', 'only-diff.ts', 'only-staged.ts', 'only-untracked.ts']);
  });

  it('returns empty array when no changes', () => {
    mockExecSync.mockReturnValue('');

    const files = getChangedFiles('/repo', defaultCopyIgnoreConfig());

    expect(files).toEqual([]);
  });

  it('handles only changed files', () => {
    mockExecSync
      .mockReturnValueOnce('modified.ts')
      .mockReturnValueOnce('')
      .mockReturnValueOnce('');

    const files = getChangedFiles('/repo', defaultCopyIgnoreConfig());

    expect(files).toEqual(['modified.ts']);
  });

  it('handles only untracked files', () => {
    mockExecSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce('')
      .mockReturnValueOnce('new-file.ts');

    const files = getChangedFiles('/repo', defaultCopyIgnoreConfig());

    expect(files).toEqual(['new-file.ts']);
  });

  it('passes cwd to execSync_', () => {
    mockExecSync.mockReturnValue('');

    getChangedFiles('/my/repo', defaultCopyIgnoreConfig());

    expect(mockExecSync).toHaveBeenCalledWith(
      'git diff --name-only',
      { cwd: '/my/repo', silent: true }
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      'git diff --cached --name-only',
      { cwd: '/my/repo', silent: true }
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      'git ls-files --others --exclude-standard',
      { cwd: '/my/repo', silent: true }
    );
  });

  it('filters packaged default host-only result directories', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-copy-ignore-'));
    mockExecSync
      .mockReturnValueOnce([
        'src/app.ts',
        'audit-results/report.json',
        'compare-results/report.json',
        'packages/app/compare-bisect-results/session.json',
      ].join('\n'))
      .mockReturnValueOnce('')
      .mockReturnValueOnce('');

    try {
      expect(getChangedFiles(repositoryRoot, defaultCopyIgnoreConfig())).toEqual(['src/app.ts']);
    } finally {
      fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('uses configured files and folders instead of the corresponding defaults', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-copy-ignore-'));
    mockExecSync
      .mockReturnValueOnce([
        'src/app.ts',
        'compare-results/report.json',
        'local-artifacts/trace.json',
        'debug.log',
      ].join('\n'))
      .mockReturnValueOnce('')
      .mockReturnValueOnce('');

    try {
      expect(getChangedFiles(repositoryRoot, {
        folders: ['local-artifacts'],
        files: ['debug.log'],
      })).toEqual(['src/app.ts', 'compare-results/report.json']);
    } finally {
      fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});

describe('getGitRootDirectory', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns the git root directory', () => {
    mockExecSync.mockReturnValue('/home/user/project');

    const root = getGitRootDirectory('/home/user/project/src');

    expect(root).toBe('/home/user/project');
  });

  it('passes cwd to execSync_', () => {
    mockExecSync.mockReturnValue('/repo');

    getGitRootDirectory('/repo/subdir');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --show-toplevel',
      { cwd: '/repo/subdir', silent: true }
    );
  });

  it('returns empty string for non-git directory', () => {
    mockExecSync.mockReturnValue('');

    const root = getGitRootDirectory('/tmp');

    expect(root).toBe('');
  });
});
