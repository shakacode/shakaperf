#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Updates packages/shaka-perf/npm-shrinkwrap.json so it stays in step with
// yarn.lock. Run from the repository-local Yarn plugin
// (.yarn/plugins/sync-npm-shrinkwrap.cjs), whose `afterAllInstalled` hook fires
// on every install — including one that rewrites yarn.lock without rebuilding
// the workspace.
//
// Errors are not caught: they abort `yarn install` with npm's own output. A
// silent failure here means the two lockfiles have drifted and nobody knows
// until the pre-commit check catches it much later. CI never regenerates a
// reviewed shrinkwrap; the pre-commit check refuses drift instead.
//
// This is a repository tool and is deliberately outside the published package,
// so a consumer install can never run it against the shrinkwrap in their own
// node_modules. The guard below still refuses to run outside this repo.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = path.join(ROOT, 'packages', 'shaka-perf');
const SHRINKWRAP = path.join(PKG_DIR, 'npm-shrinkwrap.json');
const isCI = process.env.CI && !['0', 'false'].includes(process.env.CI.toLowerCase());

// Only ever regenerate the shrinkwrap of this checkout, never one that happens
// to sit at the same relative path elsewhere.
const root = path.join(ROOT, 'package.json');
if (isCI) process.exit(0);
if (!fs.existsSync(root) || JSON.parse(fs.readFileSync(root, 'utf8')).name !== 'shakaperf') process.exit(0);

// npm before 11.6.3 can prune platform-specific optional dependencies or
// produce a different dependency tree on the second pass, leaving entries such
// as @img/sharp-wasm32 without their required transitive dependencies. Refuse
// versions that predate https://github.com/npm/cli/issues/8535.
const pluginPath = path.join(ROOT, '.yarn', 'plugins', 'sync-npm-shrinkwrap.cjs');
const { default: syncNpmShrinkwrapPlugin } = await import(pathToFileURL(pluginPath));
const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
if (!syncNpmShrinkwrapPlugin.supportsNpmVersion(npmVersion)) {
  throw new Error(
    `sync-npm-shrinkwrap requires npm >=11.6.3; found npm ${npmVersion}. ` +
    'Use the Node.js version from .nvmrc before regenerating npm-shrinkwrap.json.',
  );
}

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
  { cwd: PKG_DIR, stdio: 'inherit', timeout: Number(process.env.SHAKAPERF_NPM_SHRINKWRAP_TIMEOUT_MS || 180_000) },
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
  `sync-npm-shrinkwrap: ${Object.keys(lock.packages).length - 1} packages (${dropped.length} dev entries dropped)\n`,
);
