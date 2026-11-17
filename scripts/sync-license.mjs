/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Copies the canonical repo-root LICENSE.md into the package being packed.
//
// An npm tarball is rooted at the package directory, so the repo-root
// LICENSE.md never reaches a consumer. Every published package declares
// `"license": "SEE LICENSE IN LICENSE.md"`, which resolves against the tarball
// root -- so each package needs its own copy of the text at pack time.
//
// Runs from `prepack`, which is what Yarn executes for both `yarn pack` and
// `yarn npm publish` (Yarn does not run npm's `prepublishOnly`). Yarn sets the
// cwd to the workspace directory, which is where the copy lands.

import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'LICENSE.md');
const target = resolve(process.cwd(), 'LICENSE.md');

const licenseSha256 = 'ddb1d2c9155bf3c5f3bdd3ec1be89d9b853426bb32cc418c8bd41cdf18bf0c7c';
const firstVersion = { 'shaka-perf': [0, 8], 'shaka-shared': [0, 8], 'shaka-bundle-size': [0, 1] };

if (createHash('sha256').update(readFileSync(source)).digest('hex') !== licenseSha256) {
  throw new Error('LICENSE.md does not match the digest in scripts/sync-license.mjs');
}

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
const [major, minor] = pkg.version.split('.').map(Number);
const [firstMajor, firstMinor] = firstVersion[pkg.name] ?? [0, 0];
if (major < firstMajor || (major === firstMajor && minor < firstMinor)) {
  throw new Error(`${pkg.name} ${pkg.version} is older than the first release of this license`);
}

copyFileSync(source, target);

console.log(`sync-license: wrote ${target}`);
