/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

function runSync(license, version) {
  const fixture = mkdtempSync(join(tmpdir(), 'shakaperf-sync-'));
  try {
    mkdirSync(join(fixture, 'scripts'));
    mkdirSync(join(fixture, 'packages/shaka-perf'), { recursive: true });
    cpSync(join(root, 'scripts/sync-license.mjs'), join(fixture, 'scripts/sync-license.mjs'));
    writeFileSync(join(fixture, 'LICENSE.md'), license);
    writeFileSync(join(fixture, 'packages/shaka-perf/package.json'), JSON.stringify({ name: 'shaka-perf', version }));
    const result = spawnSync(process.execPath, [join(fixture, 'scripts/sync-license.mjs')], {
      cwd: join(fixture, 'packages/shaka-perf'),
      encoding: 'utf8',
    });
    return { result, copied: existsSync(join(fixture, 'packages/shaka-perf/LICENSE.md')) };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test('rejects a license digest mismatch before copying', () => {
  const { result, copied } = runSync('wrong license', '0.8.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LICENSE.md does not match the digest/);
  assert.equal(copied, false);
});

test('rejects a package below its first license release before copying', () => {
  const { result, copied } = runSync(readFileSync(join(root, 'LICENSE.md')), '0.7.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /shaka-perf 0\.7\.0 is older than the first release/);
  assert.equal(copied, false);
});
