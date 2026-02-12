import {
  dockerImageExists,
  getGitSha,
  getGitBranch,
  getUserId,
  getGroupId,
  getUsername,
} from '../helpers/docker';
import * as shell from '../helpers/shell';

jest.mock('../helpers/shell');
const mockExecSync = shell.execSync_ as jest.MockedFunction<typeof shell.execSync_>;

describe('dockerImageExists', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('calls docker image inspect with correct command', () => {
    mockExecSync.mockReturnValue('');

    dockerImageExists('my-app:v1.2.3');

    expect(mockExecSync).toHaveBeenCalledWith(
      'docker image inspect "my-app:v1.2.3"',
      { silent: true }
    );
  });

  it('returns true when image exists', () => {
    mockExecSync.mockReturnValue('[{"Id": "sha256:abc123"}]');

    expect(dockerImageExists('existing-image:latest')).toBe(true);
  });

  it('returns false when image does not exist', () => {
    mockExecSync.mockReturnValue('');

    expect(dockerImageExists('nonexistent-image:latest')).toBe(false);
  });
});

describe('getGitSha', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('calls git rev-parse with correct command', () => {
    mockExecSync.mockReturnValue('abc123');

    getGitSha('/my/repo');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --short HEAD',
      { cwd: '/my/repo' }
    );
  });

  it('returns the SHA from git', () => {
    mockExecSync.mockReturnValue('abc123def');

    expect(getGitSha('/repo')).toBe('abc123def');
  });

  it('returns "unknown" when git command fails', () => {
    mockExecSync.mockReturnValue('');

    expect(getGitSha('/not-a-repo')).toBe('unknown');
  });
});

describe('getGitBranch', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('calls git branch with correct command', () => {
    mockExecSync.mockReturnValue('main');

    getGitBranch('/my/repo');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git branch --show-current',
      { cwd: '/my/repo' }
    );
  });

  it('returns the branch name from git', () => {
    mockExecSync.mockReturnValue('feature/my-branch');

    expect(getGitBranch('/repo')).toBe('feature/my-branch');
  });

  it('returns "unknown" when git command fails', () => {
    mockExecSync.mockReturnValue('');

    expect(getGitBranch('/not-a-repo')).toBe('unknown');
  });
});

describe('getUserId', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('calls id -u', () => {
    mockExecSync.mockReturnValue('501');

    getUserId();

    expect(mockExecSync).toHaveBeenCalledWith('id -u');
  });

  it('returns the user id', () => {
    mockExecSync.mockReturnValue('1001');

    expect(getUserId()).toBe('1001');
  });

  it('returns "1000" as fallback', () => {
    mockExecSync.mockReturnValue('');

    expect(getUserId()).toBe('1000');
  });
});

describe('getGroupId', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('calls id -g', () => {
    mockExecSync.mockReturnValue('20');

    getGroupId();

    expect(mockExecSync).toHaveBeenCalledWith('id -g');
  });

  it('returns the group id', () => {
    mockExecSync.mockReturnValue('1001');

    expect(getGroupId()).toBe('1001');
  });

  it('returns "1000" as fallback', () => {
    mockExecSync.mockReturnValue('');

    expect(getGroupId()).toBe('1000');
  });
});

describe('getUsername', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('calls whoami', () => {
    mockExecSync.mockReturnValue('testuser');

    getUsername();

    expect(mockExecSync).toHaveBeenCalledWith('whoami');
  });

  it('returns the username', () => {
    mockExecSync.mockReturnValue('johndoe');

    expect(getUsername()).toBe('johndoe');
  });

  it('returns "user" as fallback', () => {
    mockExecSync.mockReturnValue('');

    expect(getUsername()).toBe('user');
  });
});
