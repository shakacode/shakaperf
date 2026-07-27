/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execSync_ } from './shell';
import type { CopyIgnoreConfig } from '../types';
import { createCopyIgnoreMatcher, isCopyIgnored } from './copy-ignore';

/**
 * Gets all git-changed files (staged, unstaged, and untracked)
 * Equivalent to: git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard
 */
export function getChangedFiles(cwd: string, copyIgnoreConfig: CopyIgnoreConfig): string[] {
  const diffFiles = execSync_('git diff --name-only', { cwd, silent: true });
  const stagedFiles = execSync_('git diff --cached --name-only', { cwd, silent: true });
  const untrackedFiles = execSync_('git ls-files --others --exclude-standard', { cwd, silent: true });
  const allFiles = new Set<string>();

  if (diffFiles) {
    diffFiles.split('\n').filter(Boolean).forEach(file => allFiles.add(file));
  }
  if (stagedFiles) {
    stagedFiles.split('\n').filter(Boolean).forEach(file => allFiles.add(file));
  }
  if (untrackedFiles) {
    untrackedFiles.split('\n').filter(Boolean).forEach(file => allFiles.add(file));
  }

  const copyIgnore = createCopyIgnoreMatcher(copyIgnoreConfig);
  return Array.from(allFiles).filter((file) => !isCopyIgnored(copyIgnore, file));
}

export function getGitRootDirectory(cwd: string): string {
  return execSync_('git rev-parse --show-toplevel', { cwd, silent: true });
}

export function getGitRemoteUrl(cwd: string): string {
  return execSync_('git remote get-url origin', { cwd, silent: true });
}

export function getDefaultBranch(cwd: string): string {
  // Try symbolic-ref first (works if remote HEAD is set)
  const symbolicRef = execSync_('git symbolic-ref refs/remotes/origin/HEAD', { cwd, silent: true });
  if (symbolicRef) {
    return symbolicRef.replace('refs/remotes/origin/', '');
  }
  // Fallback: check if main or master exists
  const mainExists = execSync_('git rev-parse --verify refs/remotes/origin/main', { cwd, silent: true });
  if (mainExists) return 'main';
  return 'master';
}
