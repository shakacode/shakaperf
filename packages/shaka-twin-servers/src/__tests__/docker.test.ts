import {
  dockerImageExists,
  getGitSha,
  getGitBranch,
  getUserId,
  getGroupId,
  getUsername,
} from '../helpers/docker';

describe('dockerImageExists', () => {
  it('returns false for non-existent image', () => {
    expect(dockerImageExists('nonexistent-image-xyz:latest')).toBe(false);
  });
});

describe('getGitSha', () => {
  it('returns a short SHA for a valid git directory', () => {
    const sha = getGitSha(process.cwd());
    expect(sha).toBeTruthy();
    expect(sha.length).toBeLessThanOrEqual(12);
    expect(sha).not.toBe('unknown');
  });

  it('returns "unknown" for invalid directory', () => {
    const sha = getGitSha('/nonexistent/path');
    expect(sha).toBe('unknown');
  });
});

describe('getGitBranch', () => {
  it('returns a branch name for a valid git directory', () => {
    const branch = getGitBranch(process.cwd());
    expect(branch).toBeTruthy();
  });

  it('returns "unknown" for invalid directory', () => {
    const branch = getGitBranch('/nonexistent/path');
    expect(branch).toBe('unknown');
  });
});

describe('getUserId', () => {
  it('returns a numeric string', () => {
    const uid = getUserId();
    expect(uid).toMatch(/^\d+$/);
  });
});

describe('getGroupId', () => {
  it('returns a numeric string', () => {
    const gid = getGroupId();
    expect(gid).toMatch(/^\d+$/);
  });
});

describe('getUsername', () => {
  it('returns a non-empty string', () => {
    const username = getUsername();
    expect(username).toBeTruthy();
    expect(username.length).toBeGreaterThan(0);
  });
});
