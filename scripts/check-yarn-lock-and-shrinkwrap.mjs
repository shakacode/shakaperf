#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Asserts yarn.lock (development) and packages/shaka-perf/npm-shrinkwrap.json
// (what ships to npm consumers) agree on every version. Run from pre-commit
// and CI; offline, ~50ms.
//
// Regenerate both together — resolved at the same moment under the same age
// gate the two package managers agree almost exactly (measured: 1 version in
// 490); rebuild only one and it drifts against the other (81 versions):
//
//   yarn install --mode=update-lockfile
//   cd packages/shaka-perf && npm install --package-lock-only --ignore-scripts && npm shrinkwrap
//
// That writes devDependencies into the file too (866 entries rather than 533;
// `--omit=dev` does not prevent it). They are flagged `dev: true` and npm never
// installs them for a consumer, so they are noise rather than a problem — both
// checks here skip them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHRINKWRAP = path.join(ROOT, 'packages', 'shaka-perf', 'npm-shrinkwrap.json');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** Every name@version yarn.lock resolved, plus this repo's own workspaces. */
const yarnVersions = () => {
  const set = new Set();
  for (const [, spec] of fs.readFileSync(path.join(ROOT, 'yarn.lock'), 'utf8').matchAll(/^ {2}resolution: "(.+)"$/gm)) {
    const at = spec.indexOf('@npm:', 1);
    const version = at === -1 ? '' : spec.slice(at + 5);
    if (/^\d/.test(version)) set.add(`${spec.slice(0, at)}@${version}`);
  }
  // shaka-shared is a workspace here but a registry tarball in the shrinkwrap —
  // correct, since consumers install it from npm. Compare to its own version.
  for (const dir of fs.readdirSync(path.join(ROOT, 'packages'))) {
    const manifest = path.join(ROOT, 'packages', dir, 'package.json');
    if (fs.existsSync(manifest)) {
      const ws = readJson(manifest);
      set.add(`${ws.name}@${ws.version}`);
    }
  }
  return set;
};

/**
 * Every name@version the shrinkwrap pins, under the package's REAL name.
 * `@isaacs/cliui` uses aliases (`string-width-cjs` → `npm:string-width@^4.2.0`)
 * and npm records the alias as the directory name, so the true name comes from
 * the tarball URL — otherwise every alias reads as drift. Dev entries are
 * skipped: npm never installs them for a consumer.
 */
const shrinkwrapVersions = () => {
  const set = new Set();
  for (const [key, entry] of Object.entries(readJson(SHRINKWRAP).packages ?? {})) {
    const at = key.lastIndexOf('node_modules/');
    if (at === -1 || !entry?.version || entry.dev) continue;
    const url = entry.resolved?.includes('/-/') ? new URL(entry.resolved) : null;
    set.add(`${url ? decodeURIComponent(url.pathname.slice(1).split('/-/')[0]) : key.slice(at + 13)}@${entry.version}`);
  }
  return set;
};

const yarn = yarnVersions();
const npm = shrinkwrapVersions();
const drifted = [...npm].filter((spec) => !yarn.has(spec)).sort();

if (!drifted.length) {
  process.stdout.write(`lockfiles agree on all ${npm.size} versions\n`);
  process.exit(0);
}
process.stderr.write(
  `${drifted.length} version(s) in npm-shrinkwrap.json that yarn.lock does not resolve:\n\n` +
    drifted.map((s) => `  ${s}\n`).join('') +
    '\nRegenerate both together (see the header of this file), or `yarn up <pkg>` to\nmove yarn.lock onto the published versions.\n',
);
process.exit(1);
