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
// After changing a dependency, update it the same way you would yarn.lock:
//
//   cd packages/shaka-perf && npm install --package-lock-only --ignore-scripts --no-workspaces
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
import chalk from 'chalk';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHRINKWRAP = path.join(ROOT, 'packages', 'shaka-perf', 'npm-shrinkwrap.json');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** name -> Set(version) for everything yarn.lock resolved, plus our workspaces. */
const yarnVersions = () => {
  const byName = new Map();
  const add = (name, version) => {
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(version);
  };
  for (const [, spec] of fs.readFileSync(path.join(ROOT, 'yarn.lock'), 'utf8').matchAll(/^ {2}resolution: "(.+)"$/gm)) {
    const at = spec.indexOf('@npm:', 1);
    const version = at === -1 ? '' : spec.slice(at + 5);
    if (/^\d/.test(version)) add(spec.slice(0, at), version);
  }
  // shaka-shared is a workspace here but a registry tarball in the shrinkwrap —
  // correct, since consumers install it from npm. Compare to its own version.
  for (const dir of fs.readdirSync(path.join(ROOT, 'packages'))) {
    const manifest = path.join(ROOT, 'packages', dir, 'package.json');
    if (fs.existsSync(manifest)) {
      const ws = readJson(manifest);
      add(ws.name, ws.version);
    }
  }
  return byName;
};

/**
 * Every name@version the shrinkwrap pins, under the package's REAL name.
 * `@isaacs/cliui` uses aliases (`string-width-cjs` → `npm:string-width@^4.2.0`)
 * and npm records the alias as the directory name, so the true name comes from
 * the tarball URL — otherwise every alias reads as drift.
 *
 * Skips anything a consumer never receives: entries npm flagged `dev`, plus
 * shaka-perf's own devDependencies. npm records those in the lockfile and
 * resolves them from shaka-perf's ranges alone, while Yarn resolves them across
 * every workspace — so they disagree by design and say nothing about consumers.
 */
const shrinkwrapVersions = () => {
  const manifest = readJson(path.join(ROOT, 'packages', 'shaka-perf', 'package.json'));
  const devOnly = new Set(
    Object.keys(manifest.devDependencies ?? {}).filter((n) => !manifest.dependencies?.[n]),
  );
  const byName = new Map();
  for (const [key, entry] of Object.entries(readJson(SHRINKWRAP).packages ?? {})) {
    const at = key.lastIndexOf('node_modules/');
    if (at === -1 || !entry?.version || entry.dev) continue;
    const url = entry.resolved?.includes('/-/') ? new URL(entry.resolved) : null;
    const name = url ? decodeURIComponent(url.pathname.slice(1).split('/-/')[0]) : key.slice(at + 13);
    if (devOnly.has(name)) continue;
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(entry.version);
  }
  return byName;
};

const yarn = yarnVersions();
const npm = shrinkwrapVersions();
const pinned = [...npm.values()].reduce((n, versions) => n + versions.size, 0);

const rows = [];
for (const [name, versions] of npm) {
  for (const version of versions) {
    if (yarn.get(name)?.has(version)) continue;
    rows.push({ name, yarn: [...(yarn.get(name) ?? [])].sort().join(', ') || '(absent)', npm: version });
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name));

if (!rows.length) {
  process.stdout.write(`lockfiles agree on all ${pinned} versions\n`);
  process.exit(0);
}

const width = (key, heading) => Math.max(heading.length, ...rows.map((r) => r[key].length));
const [wName, wYarn, wNpm] = [width('name', 'package'), width('yarn', 'yarn.lock'), width('npm', 'npm-shrinkwrap.json')];
const line = (a, b, c) => `  ${a.padEnd(wName)}  ${b.padEnd(wYarn)}  ${c}\n`;

process.stderr.write(
  `\n${chalk.red(`yarn.lock and npm-shrinkwrap.json resolve ${rows.length} package(s) to different versions.`)}\n\n` +
    'That is a security problem, not just untidiness. yarn.lock decides what you build\n' +
    'and test against; npm-shrinkwrap.json decides what everyone installing shaka-perf\n' +
    'from npm actually receives. While they disagree, consumers run code that was never\n' +
    'built or tested here, and a version nobody reviewed can reach them.\n\n',
);
process.stderr.write(line('package', 'yarn.lock', 'npm-shrinkwrap.json'));
process.stderr.write(line('-'.repeat(wName), '-'.repeat(wYarn), '-'.repeat(wNpm)));
for (const row of rows) process.stderr.write(line(row.name, row.yarn, row.npm));
process.exit(1);
