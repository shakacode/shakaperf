/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
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
const lock = JSON.parse(readFileSync(join(repoRoot, 'license.lock.json'), 'utf8'));
const digest = createHash('sha256').update(readFileSync(source)).digest('hex');

if (digest !== lock.sha256) {
  throw new Error('LICENSE.md does not match license.lock.json');
}

copyFileSync(source, target);

console.log(`sync-license: wrote ${target}`);
