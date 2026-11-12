/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'scripts/check-license-release.mjs');
const source = readFileSync(join(root, 'LICENSE.md'), 'utf8');
const lock = JSON.parse(readFileSync(join(root, 'license.lock.json'), 'utf8'));

function runGuard(license, version, packageVersion = version) {
  const fixture = mkdtempSync(join(tmpdir(), 'shakaperf-license-'));
  try {
    mkdirSync(join(fixture, 'scripts'));
    mkdirSync(join(fixture, 'packages/shaka-perf'), { recursive: true });
    if (existsSync(script)) cpSync(script, join(fixture, 'scripts/check-license-release.mjs'));
    writeFileSync(join(fixture, 'LICENSE.md'), license);
    writeFileSync(join(fixture, 'license.lock.json'), JSON.stringify({
      ...lock,
      sha256: createHash('sha256').update(license).digest('hex'),
    }));
    writeFileSync(join(fixture, 'packages/shaka-perf/package.json'), JSON.stringify({
      name: 'shaka-perf',
      version: packageVersion,
    }));
    return spawnSync(process.execPath, [join(fixture, 'scripts/check-license-release.mjs'), 'shaka-perf', version], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

const approved = source;
const withMarker = approved.replace(
  '# The ShakaStack License\n',
  '# The ShakaStack License\n\n[COUNSEL-1]\n',
);
const withStatus = approved.replace(
  '# The ShakaStack License\n',
  '# The ShakaStack License\n\n**Status: proposed text, pending counsel review. Not in force.**\n',
);
const withHeadingStatus = approved.replace(
  '# The ShakaStack License\n',
  '# The ShakaStack License\n\n## Status: pending legal approval\n',
);
const withBareHeadingStatus = approved.replace(
  '# The ShakaStack License\n',
  '# The ShakaStack License\n\n## Status\nPending legal approval\n',
);
const withBoldHeadingStatus = approved.replace(
  '# The ShakaStack License\n',
  '# The ShakaStack License\n\n**Status**:\nPending legal approval\n',
);
const withNotice = approved.replace(
  '# The ShakaStack License\n',
  '# The ShakaStack License\n\n**Notice: pending counsel review. Not in force.**\n',
);
const withApprovalNotice = approved.replace(
  '# The ShakaStack License\n',
  '# The ShakaStack License\n\n**Notice: proposed text, awaiting counsel approval.**\n',
);
const withCounselStatus = approved.replace(
  '# The ShakaStack License\n',
  '# The ShakaStack License\n\n**Counsel status: legal signoff required.**\n',
);

test('rejects a counsel marker', () => {
  const result = runGuard(withMarker, '0.8.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /counsel|status/i);
});

test('rejects a status notice without counsel markers', () => {
  const result = runGuard(withStatus, '0.8.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /status notice/i);
});

test('rejects a Markdown status heading', () => {
  const result = runGuard(withHeadingStatus, '0.8.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /status notice/i);
});

test('rejects a status heading without a colon', () => {
  const result = runGuard(withBareHeadingStatus, '0.8.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /status notice/i);
});

test('rejects a bold status heading', () => {
  const result = runGuard(withBoldHeadingStatus, '0.8.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /status notice/i);
});

test('rejects a pending counsel notice with another label', () => {
  const result = runGuard(withNotice, '0.8.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /status notice/i);
});

test('rejects a proposed notice awaiting counsel approval', () => {
  const result = runGuard(withApprovalNotice, '0.8.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /status notice/i);
});

test('rejects a counsel status with another heading', () => {
  const result = runGuard(withCounselStatus, '0.8.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /status notice/i);
});

test('rejects a release below its first version', () => {
  const result = runGuard(approved, '0.7.9');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /first version/i);
});

test('accepts approved text at its first version', () => {
  const result = runGuard(approved, '0.8.0');
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a tag whose version differs from the package manifest', () => {
  const result = runGuard(approved, '0.8.0', '0.7.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest version/i);
});
