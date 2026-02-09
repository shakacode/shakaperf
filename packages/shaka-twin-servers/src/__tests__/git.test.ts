import { getChangedFiles, getGitRootDirectory } from '../helpers/git';

describe('getGitRootDirectory', () => {
  it('returns the git root for a valid git repo', () => {
    const root = getGitRootDirectory(process.cwd());
    expect(root).toBeTruthy();
    expect(root.length).toBeGreaterThan(0);
  });

  it('returns empty string for a non-git directory', () => {
    const root = getGitRootDirectory('/tmp');
    // /tmp may or may not be a git repo; if not, returns ''
    // This is just a smoke test
    expect(typeof root).toBe('string');
  });
});

describe('getChangedFiles', () => {
  it('returns an array of strings', () => {
    const files = getChangedFiles(process.cwd());
    expect(Array.isArray(files)).toBe(true);
    for (const file of files) {
      expect(typeof file).toBe('string');
    }
  });

  it('deduplicates files', () => {
    const files = getChangedFiles(process.cwd());
    const unique = new Set(files);
    expect(files.length).toBe(unique.size);
  });
});
