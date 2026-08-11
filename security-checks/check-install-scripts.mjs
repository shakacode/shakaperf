#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Every install hook npm consumers can receive through shaka-perf's shrinkwrap
// must be reviewed at an exact name@version, with no stale entries. Repository-
// local Yarn and workspace lifecycle hooks are deliberately outside this check.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exactPackageVersion = /^(?:@[^/@]+\/[^/@]+|[^/@]+)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const packageNameFromPath = (packagePath) => {
  const marker = 'node_modules/';
  return packagePath.slice(packagePath.lastIndexOf(marker) + marker.length);
};

export const evaluateInstallScriptsPolicy = ({ lock, allowlist }) => {
  const errors = [];
  const found = [...new Set(
    Object.entries(lock?.packages ?? {})
      .filter(([packagePath, entry]) => packagePath && entry?.hasInstallScript && !entry.dev)
      .map(([packagePath, entry]) =>
        `${entry.name ?? packageNameFromPath(packagePath)}@${entry.version}`),
  )].sort();

  const allowedEntries = allowlist?.allowed ?? [];
  const allowedByPackage = new Map();
  for (const entry of allowedEntries) {
    if (!exactPackageVersion.test(entry?.package ?? '')) {
      errors.push(`allowlist entry is not an exact name@version: ${entry?.package ?? '(missing)'}`);
      continue;
    }
    if (!entry.reason?.trim()) errors.push(`allowlist entry ${entry.package} must have a review reason`);
    if (allowedByPackage.has(entry.package)) errors.push(`duplicate allowlist entry: ${entry.package}`);
    allowedByPackage.set(entry.package, entry);
  }

  const foundSet = new Set(found);
  for (const packageSpec of found) {
    if (!allowedByPackage.has(packageSpec)) errors.push(`unreviewed install hook: ${packageSpec}`);
  }
  for (const packageSpec of allowedByPackage.keys()) {
    if (!foundSet.has(packageSpec)) errors.push(`stale allowlist entry: ${packageSpec}`);
  }

  return { errors, found };
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const main = () => {
  const allowlist = readJson(path.join(HERE, 'install-scripts-allowlist.json'));
  const allowed = new Set(allowlist.allowed.map((entry) => entry.package));
  const result = evaluateInstallScriptsPolicy({
    lock: readJson(path.join(ROOT, 'packages', 'shaka-perf', 'npm-shrinkwrap.json')),
    allowlist,
  });

  for (const packageSpec of result.found) {
    process.stdout.write(`check-install-scripts: ${allowed.has(packageSpec) ? 'ok  ' : 'NEW '} ${packageSpec}\n`);
  }

  if (result.errors.length) {
    process.stderr.write(
      `\ncheck-install-scripts: policy failed with ${result.errors.length} issue(s):\n` +
      result.errors.map((error) => `  - ${error}`).join('\n') +
      '\nReview the package source and install hook, then update the exact allowlist.\n',
    );
    process.exit(1);
  }

  process.stdout.write(`check-install-scripts: all ${result.found.length} npm install hooks reviewed\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
