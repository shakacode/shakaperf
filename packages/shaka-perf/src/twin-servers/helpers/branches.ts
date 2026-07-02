/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { exec, execSync_, commandExists } from './shell';

export interface BranchEntry {
  name: string;
  authorEmail: string;
  authorName: string;
  committedAt: string; // ISO-8601
  isMine: boolean;
}

const QUERY = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    refs(refPrefix: "refs/heads/", first: 100, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) {
      nodes {
        name
        target {
          ... on Commit {
            committedDate
            author { email name }
          }
        }
      }
    }
  }
}`;

/**
 * Pull the 100 most-recently-pushed branches from GitHub via `gh api graphql`,
 * sort with the current git user's branches first, then by commit date desc.
 *
 * Returns null when `gh` isn't installed, isn't authenticated, or the repo
 * isn't a GitHub remote — callers should fall back to free-form text input.
 */
export async function listRemoteBranches(cwd: string): Promise<BranchEntry[] | null> {
  if (!commandExists('gh')) return null;

  const repoJson = await exec('gh', ['repo', 'view', '--json', 'owner,name'], { cwd, silent: true });
  if (repoJson.code !== 0) return null;

  let owner: string;
  let repo: string;
  try {
    const parsed = JSON.parse(repoJson.stdout) as { owner: { login: string }; name: string };
    owner = parsed.owner.login;
    repo = parsed.name;
  } catch {
    return null;
  }

  const userEmail = execSync_('git config user.email', { cwd, silent: true });

  const result = await exec('gh', [
    'api', 'graphql',
    '-f', `query=${QUERY}`,
    '-F', `owner=${owner}`,
    '-F', `repo=${repo}`,
  ], { cwd, silent: true });
  if (result.code !== 0) return null;

  let nodes: Array<{
    name: string;
    target: { committedDate: string; author: { email: string; name: string } | null } | null;
  }>;
  try {
    const parsed = JSON.parse(result.stdout);
    nodes = parsed.data?.repository?.refs?.nodes ?? [];
  } catch {
    return null;
  }

  const entries: BranchEntry[] = nodes
    .filter((n) => n.target)
    .map((n) => ({
      name: n.name,
      authorEmail: n.target!.author?.email ?? '',
      authorName: n.target!.author?.name ?? '',
      committedAt: n.target!.committedDate,
      isMine: !!userEmail && n.target!.author?.email === userEmail,
    }));

  // Stable partition: mine first, both subsets already in date-desc order from the API.
  return entries.sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    return b.committedAt.localeCompare(a.committedAt);
  });
}

export function relativeAge(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
