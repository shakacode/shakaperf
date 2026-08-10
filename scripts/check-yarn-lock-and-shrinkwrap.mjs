#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Asserts yarn.lock (development) and packages/shaka-perf/package-lock.json
// (what ships to npm consumers) agree on every version. Run from pre-commit
// and CI; offline, ~50ms.
//
// After changing a dependency, update it the same way you would yarn.lock:
//
//   cd packages/shaka-perf && npm install --package-lock-only --ignore-scripts
//
// npm keeps the existing resolutions and only touches what changed (measured: 4
// versions), so the two lockfiles stay in step without regenerating either from
// scratch. Building this file from an empty directory instead re-resolves every
// range to whatever is newest today and drifts by 81 versions — don't.
//
// npm records devDependencies here too, flagged `dev: true` (`--omit=dev` only
// affects installs, not what is written). npm never installs them for a
// consumer; both checks skip them, and so must `npm audit`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHRINKWRAP = path.join(ROOT, 'packages', 'shaka-perf', 'package-lock.json');
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
  `${drifted.length} version(s) in package-lock.json that yarn.lock does not resolve:\n\n` +
    drifted.map((s) => `  ${s}\n`).join('') +
    '\nRegenerate both together (see the header of this file), or `yarn up <pkg>` to\nmove yarn.lock onto the published versions.\n',
);
process.exit(1);
