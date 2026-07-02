/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execSync_, exec } from './shell';

export interface CheckoutInfo {
  branch: string;
  commit: string;
  upstream: string | null;
  ahead: number;
  behind: number;
}

/**
 * Lightweight, read-only snapshot of a working tree's branch state.
 * Returns null if `dir` isn't a git repo (or doesn't exist).
 *
 * Intentionally skips `git status --porcelain` (working-tree walk) so this
 * is cheap enough to poll from the menu's tick. Dirty-state checks happen
 * on demand inside `checkoutBranch` where git's own errors are good enough.
 */
export function getCheckoutInfo(dir: string): CheckoutInfo | null {
  const branch = execSync_('git rev-parse --abbrev-ref HEAD', { cwd: dir, silent: true });
  if (!branch) return null;
  const commit = execSync_('git rev-parse --short HEAD', { cwd: dir, silent: true });
  const upstream = execSync_('git rev-parse --abbrev-ref @{u}', { cwd: dir, silent: true }) || null;
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    // `rev-list --left-right --count A...B` → "<left>\t<right>"
    const counts = execSync_(`git rev-list --left-right --count ${upstream}...HEAD`, { cwd: dir, silent: true });
    const parts = counts.split(/\s+/);
    behind = Number(parts[0]) || 0;
    ahead = Number(parts[1]) || 0;
  }
  return { branch, commit, upstream, ahead, behind };
}

export interface MergeBaseInfo {
  /** Full SHA of the merge base. */
  sha: string;
  /** Short SHA for display. */
  shortSha: string;
  /** Default branch the merge base was computed against (e.g. "origin/main"). */
  defaultBranch: string;
}

/**
 * Merge base of `dir`'s HEAD with the repo's default remote branch.
 *
 * Default branch is read from `refs/remotes/origin/HEAD` (set by `git clone`
 * or `git remote set-head`). Falls back to probing `origin/main` then
 * `origin/master` if the symbolic ref isn't present.
 *
 * Returns null when no default branch / merge base can be determined
 * (no remote, unrelated histories, etc).
 */
export function findMergeBaseAgainstDefault(dir: string): MergeBaseInfo | null {
  let defaultBranch = execSync_('git symbolic-ref --short refs/remotes/origin/HEAD', { cwd: dir, silent: true });
  if (!defaultBranch) {
    for (const candidate of ['origin/main', 'origin/master']) {
      if (execSync_(`git rev-parse --verify ${candidate}`, { cwd: dir, silent: true })) {
        defaultBranch = candidate;
        break;
      }
    }
  }
  if (!defaultBranch) return null;
  const sha = execSync_(`git merge-base ${defaultBranch} HEAD`, { cwd: dir, silent: true });
  if (!sha) return null;
  const shortSha = execSync_(`git rev-parse --short ${sha}`, { cwd: dir, silent: true });
  return { sha, shortSha, defaultBranch };
}

export interface CheckoutResult {
  ok: boolean;
  message: string;
}

/**
 * Switch `dir` onto `ref`, fetch, and fast-forward to upstream.
 *
 * `ref` may be:
 *   - a local branch name ("main"): checked out; if missing, git's DWIM
 *     creates a local tracking branch from `origin/<ref>` if it exists.
 *   - a fully qualified remote ref ("origin/feature-x"): the remote prefix
 *     is stripped and a local tracking branch is created/updated.
 *
 * Bails (no changes) if the local branch and its upstream have diverged
 * (both have commits the other doesn't). Caller is responsible for
 * resolving manually.
 */
export async function checkoutBranch(
  dir: string,
  ref: string,
  opts: { verbose?: boolean } = {},
): Promise<CheckoutResult> {
  const silent = !opts.verbose;

  const fetched = await exec('git', ['fetch', '--all', '--prune'], { cwd: dir, silent });
  if (fetched.code !== 0) {
    return { ok: false, message: `git fetch failed: ${(fetched.stderr || fetched.stdout).trim()}` };
  }

  // Map "origin/foo" → local branch "foo" with explicit --track. A bare
  // `git checkout origin/foo` would land in detached HEAD instead.
  let localBranch = ref;
  let remoteRef: string | null = null;
  const slash = ref.indexOf('/');
  if (slash > 0) {
    remoteRef = ref;
    localBranch = ref.slice(slash + 1);
  }

  // Use argv form, not `execSync_` (shell expansion) — `localBranch` can
  // come from user input in the branch picker and a string like
  // `main; rm -rf ~` would otherwise execute.
  const localExistsResult = await exec(
    'git',
    ['rev-parse', '--verify', `refs/heads/${localBranch}`],
    { cwd: dir, silent: true },
  );
  const localExists = localExistsResult.code === 0;

  let checkoutArgs: string[];
  if (localExists) {
    checkoutArgs = ['checkout', localBranch];
  } else if (remoteRef) {
    checkoutArgs = ['checkout', '-b', localBranch, '--track', remoteRef];
  } else {
    checkoutArgs = ['checkout', localBranch];
  }

  const checkedOut = await exec('git', checkoutArgs, { cwd: dir, silent });
  if (checkedOut.code !== 0) {
    return { ok: false, message: `git checkout failed: ${(checkedOut.stderr || checkedOut.stdout).trim()}` };
  }

  const info = getCheckoutInfo(dir);
  if (!info) {
    return { ok: false, message: 'cannot read checkout info after checkout' };
  }
  if (!info.upstream) {
    return { ok: true, message: `on ${info.branch} @ ${info.commit} (no upstream — nothing to pull)` };
  }
  if (info.ahead > 0 && info.behind > 0) {
    return {
      ok: false,
      message: `${info.branch} diverged from ${info.upstream} (${info.ahead} ahead, ${info.behind} behind) — refusing to pull, resolve manually`,
    };
  }
  if (info.behind > 0) {
    const pulled = await exec('git', ['pull', '--ff-only'], { cwd: dir, silent });
    if (pulled.code !== 0) {
      return { ok: false, message: `git pull --ff-only failed: ${(pulled.stderr || pulled.stdout).trim()}` };
    }
  }

  const after = getCheckoutInfo(dir) ?? info;
  return { ok: true, message: `on ${after.branch} @ ${after.commit}` };
}
