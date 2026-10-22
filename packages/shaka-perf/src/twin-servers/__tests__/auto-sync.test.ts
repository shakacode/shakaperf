/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncPendingPaths } from '../helpers/auto-sync';

it('retries a failed file across unrelated successful batches until the entire source copy succeeds', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-sync-retry-'));
  const pending = new Set(['failed.txt']);
  const copy = (file: string) => fs.copyFileSync(path.join(directory, file), path.join(directory, `copied-${file}`));
  try {
    expect(syncPendingPaths(pending, copy)).toHaveLength(1);
    fs.writeFileSync(path.join(directory, 'other.txt'), 'other source');
    pending.add('other.txt');
    expect(syncPendingPaths(pending, copy)).toHaveLength(1);
    expect([...pending]).toEqual(['failed.txt']);
    expect(fs.readFileSync(path.join(directory, 'copied-other.txt'), 'utf8')).toBe('other source');
    fs.writeFileSync(path.join(directory, 'failed.txt'), 'repaired source');
    expect(syncPendingPaths(pending, copy)).toHaveLength(0);
    expect([...pending]).toEqual([]);
    expect(fs.readFileSync(path.join(directory, 'copied-failed.txt'), 'utf8')).toBe('repaired source');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
