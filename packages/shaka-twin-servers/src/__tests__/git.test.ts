import { getChangedFiles, getGitRootDirectory } from '../helpers/git';
import * as shell from '../helpers/shell';

jest.mock('../helpers/shell');
const mockExecSync = shell.execSync_ as jest.MockedFunction<typeof shell.execSync_>;

describe('getChangedFiles', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns changed and untracked files combined', () => {
    mockExecSync
      .mockReturnValueOnce('file1.ts\nfile2.ts')  // git diff
      .mockReturnValueOnce('file3.ts');            // untracked

    const files = getChangedFiles('/repo');

    expect(files).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
  });

  it('deduplicates files appearing in both outputs', () => {
    mockExecSync
      .mockReturnValueOnce('shared.ts\nonly-diff.ts')
      .mockReturnValueOnce('shared.ts\nonly-untracked.ts');

    const files = getChangedFiles('/repo');

    expect(files).toEqual(['shared.ts', 'only-diff.ts', 'only-untracked.ts']);
  });

  it('returns empty array when no changes', () => {
    mockExecSync.mockReturnValue('');

    const files = getChangedFiles('/repo');

    expect(files).toEqual([]);
  });

  it('handles only changed files', () => {
    mockExecSync
      .mockReturnValueOnce('modified.ts')
      .mockReturnValueOnce('');

    const files = getChangedFiles('/repo');

    expect(files).toEqual(['modified.ts']);
  });

  it('handles only untracked files', () => {
    mockExecSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce('new-file.ts');

    const files = getChangedFiles('/repo');

    expect(files).toEqual(['new-file.ts']);
  });

  it('passes cwd to execSync_', () => {
    mockExecSync.mockReturnValue('');

    getChangedFiles('/my/repo');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git diff --name-only',
      { cwd: '/my/repo', silent: true }
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      'git ls-files --others --exclude-standard',
      { cwd: '/my/repo', silent: true }
    );
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
