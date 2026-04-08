import { execSync } from 'node:child_process';

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function getDefaultBranch(): string {
  // Try symbolic-ref first (works if remote HEAD is set)
  const symbolicRef = exec('git symbolic-ref refs/remotes/origin/HEAD');
  if (symbolicRef) {
    return symbolicRef.replace('refs/remotes/origin/', '');
  }
  // Fallback: check if main or master exists
  if (exec('git rev-parse --verify refs/remotes/origin/main')) return 'main';
  return 'master';
}

function getTimestampFallback(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
}

export function getGitRunId(): string {
  const headSha = exec('git rev-parse --short HEAD');
  if (!headSha) return getTimestampFallback();

  const defaultBranch = getDefaultBranch();
  const mergeBase = exec(`git merge-base HEAD origin/${defaultBranch}`);
  const controlSha = mergeBase ? exec(`git rev-parse --short ${mergeBase}`) : headSha;

  const isDirty = exec('git status --porcelain') !== '';
  const experimentId = isDirty ? 'unstaged_changes' : headSha;

  return `${controlSha}_vs_${experimentId}`;
}
