/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const license = readFileSync(join(root, 'LICENSE.md'));
const lock = JSON.parse(readFileSync(join(root, 'license.lock.json'), 'utf8'));
const [name, version] = process.argv.slice(2);

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '');
  if (!match) throw new Error(`Invalid package version: ${value}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

try {
  const firstVersion = lock.first_versions[name];
  if (!firstVersion) throw new Error(`No first version for package: ${name}`);
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(`Tag does not match manifest version for ${name}`);
  }
  if (createHash('sha256').update(license).digest('hex') !== lock.sha256) {
    throw new Error('License does not match license.lock.json');
  }
  const text = license.toString('utf8');
  if (/\[COUNSEL-\d+\]/.test(text) || /\bStatus:|pending counsel review|not in force/i.test(text)) {
    throw new Error('License has a counsel marker or status notice');
  }
  if (compareVersions(version, firstVersion) < 0) {
    throw new Error(`Package is below its first version: ${name} ${firstVersion}`);
  }
  console.log(`License release check passed for ${name} ${version}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
