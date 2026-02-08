import { execSync_ } from './shell';

/**
 * Gets all git-changed files (staged, unstaged, and untracked)
 * Equivalent to: git diff --name-only && git ls-files --others --exclude-standard
 */
export function getChangedFiles(cwd: string): string[] {
  const diffFiles = execSync_('git diff --name-only', { cwd, silent: true });
  const untrackedFiles = execSync_('git ls-files --others --exclude-standard', { cwd, silent: true });
  const allFiles = new Set<string>();

  if (diffFiles) {
    diffFiles.split('\n').filter(Boolean).forEach(file => allFiles.add(file));
  }
  if (untrackedFiles) {
    untrackedFiles.split('\n').filter(Boolean).forEach(file => allFiles.add(file));
  }

  return Array.from(allFiles);
}

export function getGitRootDirectory(cwd: string): string {
  return execSync_('git rev-parse --show-toplevel', { cwd, silent: true });
}
