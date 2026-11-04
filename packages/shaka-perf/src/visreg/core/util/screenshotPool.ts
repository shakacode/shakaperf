/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { compareBuffers } from './compare/pixelmatch-inline';

/**
 * Crash-resumable accumulation of screenshots for a single comparison
 * (one scenario × viewport × selector).
 *
 * Visreg rendering is flaky (a frame can differ run-to-run) and the whole stage
 * can crash/time-out and be restarted by the worker pool. To survive both,
 * every captured control/experiment frame is written straight into the unit's
 * `control_screenshots/` / `experiment_screenshots/` dirs — the SAME dirs the
 * report reads from, so there's no second copy. A restarted attempt re-loads
 * everything captured so far and keeps accumulating instead of starting over.
 *
 * Frames are named `<key>__<sha1>.png`, where `<key>` is the comparison's
 * filename template: the `__<sha1>` suffix lets many frames per comparison
 * coexist (re-capturing an identical frame is a no-op — the pool holds DISTINCT
 * frames only), while the shared `<key>` prefix lets a restart find them again.
 * Cleanup is NOT done here: the runner wipes the unit dir once per test, before
 * any stage runs, which clears these dirs generically.
 */
export type PoolSide = 'control' | 'experiment';

const FRAME_SEP = '__';

export interface PoolFrame {
  /** Absolute path of the frame on disk (becomes the report's reference/test). */
  readonly path: string;
  readonly buffer: Buffer;
}

export class ScreenshotPool {
  constructor(
    private readonly controlDir: string,
    private readonly experimentDir: string,
    private readonly key: string,
  ) {}

  private dirFor(side: PoolSide): string {
    return side === 'control' ? this.controlDir : this.experimentDir;
  }

  /** Distinct frames accumulated for a side so far, oldest first. */
  load(side: PoolSide): PoolFrame[] {
    const dir = this.dirFor(side);
    const prefix = this.key + FRAME_SEP;
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.png')).sort();
    } catch {
      return [];
    }
    const out: PoolFrame[] = [];
    for (const name of names) {
      const p = path.join(dir, name);
      try {
        out.push({ path: p, buffer: fs.readFileSync(p) });
      } catch {
        // A sibling attempt may be mid-write — skip it.
      }
    }
    return out;
  }

  /**
   * Persist a freshly captured frame. Content-addressed: an identical re-capture
   * is a no-op. Returns the frame (its on-disk path + buffer).
   */
  add(side: PoolSide, buffer: Buffer): PoolFrame {
    const hash = crypto.createHash('sha1').update(buffer).digest('hex');
    const dir = this.dirFor(side);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${this.key}${FRAME_SEP}${hash}.png`);
    if (!fs.existsSync(p)) fs.writeFileSync(p, buffer);
    return { path: p, buffer };
  }
}

export interface CrossMatchOptions {
  maxNumDiffPixels: number;
  pixelmatchThreshold: number;
}

export interface CrossMatchResult {
  pass: boolean;
  /** Index into the control pool of the chosen (matching or closest) frame. */
  controlIndex: number;
  /** Index into the experiment pool of the chosen frame. */
  experimentIndex: number;
  /** Pixelmatch diff PNG of the chosen pair — null when the pair matches. */
  diffBuffer: Buffer | null;
  leastDiffPixels: number;
}

/**
 * Compare every accumulated control frame against every accumulated experiment
 * frame. If ANY pair is within tolerance the comparison is a match (rendering
 * is merely unstable, not regressed). Otherwise return the CLOSEST pair — the
 * least-different control/experiment frames — so the report shows the fairest
 * possible diff rather than an arbitrary one.
 *
 * O(control × experiment), but both pools are bounded by the retry budget, so
 * this stays tiny.
 */
export function crossMatch(
  control: readonly Buffer[],
  experiment: readonly Buffer[],
  opts: CrossMatchOptions,
): CrossMatchResult {
  let leastDiffPixels = Infinity;
  let bestControlIndex = 0;
  let bestExperimentIndex = 0;
  let bestDiffPng: PNG | null = null;

  for (let c = 0; c < control.length; c++) {
    for (let e = 0; e < experiment.length; e++) {
      const result = compareBuffers(control[c], experiment[e], { threshold: opts.pixelmatchThreshold });
      if (result.numDiffPixels <= opts.maxNumDiffPixels) {
        return {
          pass: true,
          controlIndex: c,
          experimentIndex: e,
          diffBuffer: null,
          leastDiffPixels: result.numDiffPixels,
        };
      }
      if (result.numDiffPixels < leastDiffPixels) {
        leastDiffPixels = result.numDiffPixels;
        bestControlIndex = c;
        bestExperimentIndex = e;
        bestDiffPng = result.diffPng;
      }
    }
  }

  return {
    pass: false,
    controlIndex: bestControlIndex,
    experimentIndex: bestExperimentIndex,
    diffBuffer: bestDiffPng ? PNG.sync.write(bestDiffPng, { filterType: 4 }) : null,
    leastDiffPixels,
  };
}
