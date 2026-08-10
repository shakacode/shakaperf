#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Fails if a package in shaka-perf's published graph runs an install hook that
// nobody has reviewed. A malicious postinstall in a transitive dependency is the
// highest-value attack on a CLI people install globally, and shipping a
// shrinkwrap rather than a bundled node_modules means those hooks cannot be
// stripped from the tarball — so the defence is that a NEW one cannot appear
// unnoticed.
//
// The signal is npm's `hasInstallScript`, recorded per package in the
// shrinkwrap. It covers the whole graph including other platforms, and needs no
// node_modules — which matters, since Yarn PnP means this repo has none.
// Allowlisting name@version is a tripwire for free: a package cannot change its
// install script without a version bump, and the new version is not on the list.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const lock = readJson(path.join(ROOT, 'packages', 'shaka-perf', 'package-lock.json'));
const allowed = new Set(readJson(path.join(ROOT, 'scripts', 'install-scripts-allowlist.json')).allowed.map((e) => e.package));

const found = Object.entries(lock.packages)
  .filter(([key, entry]) => key && entry.hasInstallScript && !entry.dev)
  .map(([key, entry]) => `${key.slice(key.lastIndexOf('node_modules/') + 13)}@${entry.version}`);

const unreviewed = found.filter((spec) => !allowed.has(spec));

for (const spec of found) process.stdout.write(`check-install-scripts: ${allowed.has(spec) ? 'ok  ' : 'NEW '} ${spec}\n`);

if (unreviewed.length) {
  process.stderr.write(
    `\ncheck-install-scripts: ${unreviewed.length} unreviewed install hook(s): ${unreviewed.join(', ')}\n` +
      'Read each package\'s install script, then add it to scripts/install-scripts-allowlist.json\n' +
      'with a reason. Inspect one with: npm view <name>@<version> scripts\n',
  );
  process.exit(1);
}
process.stdout.write(`check-install-scripts: all ${found.length} install hooks reviewed\n`);
