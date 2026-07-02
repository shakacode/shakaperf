/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquireMeasurementLock } from '../measurement-lock';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('acquireMeasurementLock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-measure-lock-'));
    lockPath = path.join(dir, 'measure.lock');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('acquires immediately when free and writes the holder PID; release removes the file', async () => {
    const lock = await acquireMeasurementLock({ lockPath, pollMs: 10, quiet: true });
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
    lock.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('release is idempotent', async () => {
    const lock = await acquireMeasurementLock({ lockPath, pollMs: 10, quiet: true });
    lock.release();
    expect(() => lock.release()).not.toThrow();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('takes over a stale lock left by a dead holder', async () => {
    fs.writeFileSync(lockPath, String(2147483646), 'utf8'); // a PID that is never alive
    const lock = await acquireMeasurementLock({ lockPath, pollMs: 10, quiet: true });
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
    lock.release();
  });

  it('queues behind a live holder, then proceeds once the lock is freed', async () => {
    // A live PID (our own) holds the lock, so acquisition must block.
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');
    const acquiring = acquireMeasurementLock({ lockPath, pollMs: 20, quiet: true });

    const outcome = await Promise.race([
      acquiring.then(() => 'acquired'),
      delay(150).then(() => 'still-waiting'),
    ]);
    expect(outcome).toBe('still-waiting');

    // Free the lock; the next poll should acquire it.
    fs.unlinkSync(lockPath);
    const lock = await acquiring;
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
    lock.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
