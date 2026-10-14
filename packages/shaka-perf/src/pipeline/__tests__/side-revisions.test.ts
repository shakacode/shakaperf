import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readSideRevisions } from '../side-revisions';

function initRepo(dir: string, branch: string): string {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q', '-b', branch);
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return git('rev-parse', '--short', 'HEAD');
}

describe('readSideRevisions', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-revisions-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('reads the branch and short commit of each checkout, relative to cwd', () => {
    fs.mkdirSync(path.join(root, 'control'));
    fs.mkdirSync(path.join(root, 'experiment'));
    const controlCommit = initRepo(path.join(root, 'control'), 'main');
    const experimentCommit = initRepo(path.join(root, 'experiment'), 'feature');

    expect(readSideRevisions({ controlDir: 'control', experimentDir: 'experiment' }, root)).toEqual({
      control: { branch: 'main', commit: controlCommit },
      experiment: { branch: 'feature', commit: experimentCommit },
    });
  });

  it('leaves out a side that is not a git checkout and reports nothing without twin servers', () => {
    fs.mkdirSync(path.join(root, 'experiment'));
    const experimentCommit = initRepo(path.join(root, 'experiment'), 'feature');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(readSideRevisions({ controlDir: 'missing', experimentDir: 'experiment' }, root)).toEqual({
        experiment: { branch: 'feature', commit: experimentCommit },
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
    expect(readSideRevisions(undefined, root)).toEqual({});
  });
});
