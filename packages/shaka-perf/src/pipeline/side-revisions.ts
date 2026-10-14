/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { expandTilde } from '../twin-servers/config';

export interface SideRevision {
  /** Branch name, or `HEAD` when detached. */
  branch: string;
  /** Abbreviated commit hash. */
  commit: string;
}

/** What each twin-servers checkout had checked out when the run started. */
export interface SideRevisions {
  control?: SideRevision;
  experiment?: SideRevision;
}

interface TwinServersDirs {
  controlDir: string;
  experimentDir: string;
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function readSideRevision(dir: string): SideRevision {
  return {
    branch: git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'),
    commit: git(dir, 'rev-parse', '--short', 'HEAD'),
  };
}

/**
 * Branch and commit of the control and experiment checkouts named by the
 * twin-servers config, resolved like twin-servers resolves them. A side whose
 * directory is missing or is not a git checkout is left out with a warning:
 * the report still renders, it just cannot say what that side was.
 */
export function readSideRevisions(
  twinServers: TwinServersDirs | undefined,
  cwd: string,
): SideRevisions {
  if (!twinServers) return {};
  const revisions: SideRevisions = {};
  const sides = [
    ['control', twinServers.controlDir],
    ['experiment', twinServers.experimentDir],
  ] as const;
  for (const [side, configured] of sides) {
    const dir = path.resolve(cwd, expandTilde(configured));
    try {
      revisions[side] = readSideRevision(dir);
    } catch {
      console.warn(`${side} revision unknown: ${dir} is not a git checkout`);
    }
  }
  return revisions;
}
