/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(join(root, 'LICENSE.md'));
const lock = JSON.parse(readFileSync(join(root, 'license.lock.json'), 'utf8'));

function sync(sha256) {
  const fixture = mkdtempSync(join(tmpdir(), 'shakaperf-sync-'));
  try {
    mkdirSync(join(fixture, 'scripts'));
    mkdirSync(join(fixture, 'packages/shaka-perf'), { recursive: true });
    cpSync(join(root, 'scripts/sync-license.mjs'), join(fixture, 'scripts/sync-license.mjs'));
    writeFileSync(join(fixture, 'LICENSE.md'), source);
    writeFileSync(join(fixture, 'license.lock.json'), JSON.stringify({ ...lock, sha256 }));
    const result = spawnSync(process.execPath, [join(fixture, 'scripts/sync-license.mjs')], {
      cwd: join(fixture, 'packages/shaka-perf'),
      encoding: 'utf8',
    });
    const target = join(fixture, 'packages/shaka-perf/LICENSE.md');
    return { result, copied: existsSync(target) ? readFileSync(target) : null };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test('rejects a license whose digest differs from the lock', () => {
  const { result, copied } = sync('0'.repeat(64));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /license.lock.json/);
  assert.equal(copied, null);
});

test('copies the locked license into a package', () => {
  const { result, copied } = sync(lock.sha256);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(copied, source);
});
