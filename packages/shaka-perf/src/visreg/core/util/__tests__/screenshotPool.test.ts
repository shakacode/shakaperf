/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { crossMatch, ScreenshotPool } from '../screenshotPool';

// Solid-colour PNG buffer; `dirtyPixels` flips the first N pixels to white so
// two otherwise-identical frames differ by a controllable number of pixels.
function png(w: number, h: number, rgb: [number, number, number], dirtyPixels = 0): Buffer {
  const image = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const dirty = i < dirtyPixels;
    image.data[o] = dirty ? 255 : rgb[0];
    image.data[o + 1] = dirty ? 255 : rgb[1];
    image.data[o + 2] = dirty ? 255 : rgb[2];
    image.data[o + 3] = 255;
  }
  return PNG.sync.write(image);
}

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const OPTS = { maxNumDiffPixels: 0, pixelmatchThreshold: 0.1 };

describe('crossMatch', () => {
  it('matches when a control frame equals an experiment frame', () => {
    const r = crossMatch([png(8, 8, BLUE)], [png(8, 8, BLUE)], OPTS);
    expect(r.pass).toBe(true);
    expect(r.diffBuffer).toBeNull();
    expect(r.leastDiffPixels).toBe(0);
  });

  it('reports a mismatch with the closest pair and a diff when nothing matches', () => {
    const r = crossMatch([png(8, 8, RED)], [png(8, 8, BLUE)], OPTS);
    expect(r.pass).toBe(false);
    expect(r.leastDiffPixels).toBeGreaterThan(0);
    expect(r.diffBuffer).not.toBeNull();
  });

  it('matches across the full cross-product, not just same-index pairs', () => {
    // control[0] (red) mismatches experiment[0] (blue), but control[1] (blue)
    // matches it — any matching pair is a match.
    const r = crossMatch([png(8, 8, RED), png(8, 8, BLUE)], [png(8, 8, BLUE)], OPTS);
    expect(r.pass).toBe(true);
    expect(r.controlIndex).toBe(1);
    expect(r.experimentIndex).toBe(0);
  });

  it('returns the least-different pair when giving up', () => {
    // experiment is blue; control has a wildly-different red and a near-blue
    // (blue with 3 dirty pixels). Neither matches at maxNumDiffPixels 0, but the
    // near-blue is the fairest diff to show.
    const control = [png(8, 8, RED), png(8, 8, BLUE, 3)];
    const r = crossMatch(control, [png(8, 8, BLUE)], OPTS);
    expect(r.pass).toBe(false);
    expect(r.controlIndex).toBe(1);
    expect(r.leastDiffPixels).toBe(3);
  });
});

describe('ScreenshotPool', () => {
  let root: string;
  let controlDir: string;
  let experimentDir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'visreg-pool-'));
    controlDir = path.join(root, 'control_screenshots');
    experimentDir = path.join(root, 'experiment_screenshots');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function pool(key = 'key') {
    return new ScreenshotPool(controlDir, experimentDir, key);
  }

  it('round-trips frames per side and writes them into the side dirs', () => {
    const c = png(4, 4, RED);
    const e = png(4, 4, BLUE);
    const cFrame = pool().add('control', c);
    pool().add('experiment', e);
    expect(cFrame.path.startsWith(controlDir)).toBe(true);
    expect(fs.existsSync(cFrame.path)).toBe(true);
    expect(pool().load('control')).toHaveLength(1);
    expect(pool().load('experiment')).toHaveLength(1);
    expect(pool().load('control')[0].buffer.equals(c)).toBe(true);
  });

  it('content-addresses frames so identical re-captures do not grow the pool', () => {
    const frame = png(4, 4, RED);
    expect(pool().add('control', frame).path).toBe(pool().add('control', frame).path);
    expect(pool().load('control')).toHaveLength(1);
    pool().add('control', png(4, 4, BLUE));
    expect(pool().load('control')).toHaveLength(2);
  });

  it('resumes: a fresh pool on the same dirs+key sees earlier frames', () => {
    pool().add('control', png(4, 4, RED));
    // Simulate a crash + restart: a brand-new pool instance, same location.
    expect(pool().load('control')).toHaveLength(1);
    pool().add('experiment', png(4, 4, BLUE));
    expect(pool().load('experiment')).toHaveLength(1);
  });

  it('keeps distinct comparison keys separate within the same dirs', () => {
    new ScreenshotPool(controlDir, experimentDir, 'a').add('control', png(4, 4, RED));
    expect(new ScreenshotPool(controlDir, experimentDir, 'b').load('control')).toHaveLength(0);
  });

  it('returns an empty pool before anything is added', () => {
    expect(pool('fresh').load('control')).toEqual([]);
  });
});
