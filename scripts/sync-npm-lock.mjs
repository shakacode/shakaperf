#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Updates packages/shaka-perf/npm-shrinkwrap.json so it stays in step with
// yarn.lock. Run from that workspace's `postinstall`, which Yarn triggers
// exactly when it rebuilds the workspace — i.e. when the dependency tree
// changed, which is when the lockfile needs updating.
//
// Errors are not caught: they abort `yarn install` with npm's own output. A
// silent failure here means the two lockfiles have drifted and nobody knows
// until the pre-commit check catches it much later. Set SHAKAPERF_SKIP_NPM_LOCK=1
// to skip deliberately (offline work); the pre-commit check still refuses drift.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHRINKWRAP = path.join(ROOT, 'packages', 'shaka-perf', 'npm-shrinkwrap.json');

// shaka-perf's postinstall also runs on a consumer's machine. Unguarded, npm
// would rewrite the shrinkwrap sitting in their node_modules — the very file it
// just used to decide what to install. Only proceed inside this repo.
const root = path.join(ROOT, 'package.json');
if (process.env.SHAKAPERF_SKIP_NPM_LOCK === '1') process.exit(0);
if (!fs.existsSync(root) || JSON.parse(fs.readFileSync(root, 'utf8')).name !== 'shakaperf') process.exit(0);

// --no-workspaces: npm otherwise walks up to the monorepo root and aborts on a
// sibling workspace's `workspace:` range, which it cannot parse.
// --fetch-retries and the timeout: npm retries a refused registry with backoff,
// so without them an unreachable one stalls the install for many minutes.
execFileSync(
  'npm',
  [
    'install', '--package-lock-only', '--ignore-scripts', '--no-workspaces',
    '--no-audit', '--no-fund', '--fetch-retries=1', '--fetch-timeout=30000',
  ],
  { cwd: path.dirname(SHRINKWRAP), stdio: 'inherit', timeout: Number(process.env.SHAKAPERF_NPM_LOCK_TIMEOUT_MS || 180_000) },
);

// npm records devDependencies whatever you pass (`--omit=dev` only affects
// installs). Left in, a consumer gets all 380 of them written to disk and
// flagged `extraneous`. Dropping the dev-flagged entries afterwards yields a
// file byte-identical to resolving from a manifest that never had them.
const lock = JSON.parse(fs.readFileSync(SHRINKWRAP, 'utf8'));
const dropped = Object.entries(lock.packages).filter(([key, entry]) => key && entry.dev);
for (const [key] of dropped) delete lock.packages[key];
delete lock.packages[''].devDependencies;
fs.writeFileSync(SHRINKWRAP, `${JSON.stringify(lock, null, 2)}\n`);

process.stdout.write(
  `sync-npm-lock: ${Object.keys(lock.packages).length - 1} packages (${dropped.length} dev entries dropped)\n`,
);
