/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkoutBranch } from '../helpers/checkout';

describe('checkoutBranch with real Git branches', () => {
  let dir: string;
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-checkout-'));
    git('init', '-b', 'main');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'base');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('preserves a local branch prefix even when its suffix is another branch', async () => {
    git('branch', 'feature/login');
    git('branch', 'login');
    expect((await checkoutBranch(dir, 'feature/login')).ok).toBe(true);
    expect(git('branch', '--show-current')).toBe('feature/login');
  });

  it('creates the full local branch name from a remote branch', async () => {
    git('branch', 'feature/login');
    git('clone', '--bare', '.', 'remote.git');
    git('remote', 'add', 'origin', path.join(dir, 'remote.git'));
    git('fetch', 'origin');
    git('branch', '-D', 'feature/login');
    expect((await checkoutBranch(dir, 'feature/login')).ok).toBe(true);
    expect(git('branch', '--show-current')).toBe('feature/login');
    expect(git('rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/feature/login');
  });

  it('strips a configured remote prefix while preserving nested branch names', async () => {
    git('branch', 'feature/login');
    git('clone', '--bare', '.', 'remote.git');
    git('remote', 'add', 'upstream', path.join(dir, 'remote.git'));
    git('fetch', 'upstream');
    git('branch', '-D', 'feature/login');
    expect((await checkoutBranch(dir, 'upstream/feature/login')).ok).toBe(true);
    expect(git('branch', '--show-current')).toBe('feature/login');
    expect(git('rev-parse', '--abbrev-ref', '@{u}')).toBe('upstream/feature/login');
  });
});
