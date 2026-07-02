/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { embedAsBase64 } from 'shaka-shared';
import type { Viewport } from '../../../config';
import type { VisregArtifact } from '../visreg';
import { bufferToAvifDataUri } from '../../../pipeline/artifact-compression';

const VISREG_AVIF_QUALITY = 55;
const VISREG_IMAGE_SCALE = 0.75;

type DiffBbox = NonNullable<VisregArtifact['diffBbox']>;

function readPngDims(absPath: string): { w: number; h: number } | null {
  try {
    const png = PNG.sync.read(fs.readFileSync(absPath));
    return { w: png.width, h: png.height };
  } catch {
    return null;
  }
}

interface DiffScan {
  bbox: DiffBbox;
  /**
   * Count of "red" diff pixels (pixelmatch marks true diffs red, anti-
   * aliasing yellow — we count only the red ones for the reported "diff
   * pixels" number so it matches the user's mental model of "pixels that
   * actually changed").
   */
  diffPixels: number;
}

// Fraction of the viewport-shaped crop height to reserve above the first
// diffing row, so the diff isn't flush against the top edge and the reader
// sees a little of the page that comes before it.
const FIRST_DIFF_TOP_PADDING_FRACTION = 0.15;

/**
 * Scan a pixelmatch-generated diff PNG for the first row of highlighted
 * pixels and the count of red (true-diff) pixels. The returned crop spans
 * the full image width and is sized like the viewport (same aspect ratio
 * as `viewport.width × viewport.height`), positioned so the first diffing
 * row sits a short way down from the top — i.e. what you'd see if you
 * scrolled the page to the first regression.
 *
 * Matching pixels are rendered grayscale; diff pixels are red, AA pixels
 * are yellow — both satisfy r!==g || g!==b. For the pixel count we narrow
 * to red only (g===0) so anti-aliased edges don't inflate the number.
 */
function scanDiffPng(
  diffPath: string,
  controlDims: { w: number; h: number } | null,
  experimentDims: { w: number; h: number } | null,
  viewport: Viewport,
): DiffScan | null {
  let png: PNG;
  try {
    png = PNG.sync.read(fs.readFileSync(diffPath));
  } catch {
    return null;
  }
  const { data, width, height } = png;
  if (width === 0 || height === 0) return null;

  const isHighlighted = (i: number): boolean =>
    data[i] !== data[i + 1] || data[i + 1] !== data[i + 2];
  // pixelmatch renders true-diff pixels as (255, 0, 0); AA pixels are
  // (255, 255, 0). r>0 && g===0 picks only the red ones.
  const isRedDiff = (i: number): boolean => data[i] > 0 && data[i + 1] === 0;

  let y0 = -1;
  let diffPixels = 0;
  for (let y = 0; y < height; y++) {
    let rowHasDiff = false;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (isHighlighted(i)) {
        rowHasDiff = true;
        if (isRedDiff(i)) diffPixels++;
      }
    }
    if (rowHasDiff && y0 < 0) y0 = y;
  }
  if (y0 < 0) return null;

  // Crop is full-width by a viewport-shaped slice. Image width is the
  // viewport's pixel width (screenshots are taken at the viewport size,
  // scaled by DPR), so we can derive the viewport's pixel height directly
  // from the viewport's CSS aspect ratio.
  const cropW = width;
  const desiredCropH = Math.round(width * viewport.height / viewport.width);
  const cropH = Math.min(height, Math.max(1, desiredCropH));
  const padTop = Math.round(cropH * FIRST_DIFF_TOP_PADDING_FRACTION);
  const cropX = 0;
  const cropY = Math.max(0, Math.min(height - cropH, y0 - padTop));

  return {
    bbox: {
      x: cropX,
      y: cropY,
      w: cropW,
      h: cropH,
      imgW: width,
      controlImgH: controlDims?.h ?? height,
      experimentImgH: experimentDims?.h ?? height,
      diffImgH: height,
    },
    diffPixels,
  };
}

interface VisregPair {
  reference?: string;
  test?: string;
  diffImage?: string | null;
  pixelmatchDiffImage?: string | null;
  selector?: string;
  label?: string;
  viewportLabel?: string;
  misMatchThreshold?: number;
  diff?: {
    misMatchPercentage?: number | string;
    isSameDimensions?: boolean;
  };
  error?: string | null;
  engineErrorMsg?: string | null;
  savedByRetries?: boolean;
}

interface VisregPerTestReport {
  testSuite?: string;
  tests?: Array<{ pair: VisregPair; status?: string }>;
}

function coerceNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export interface ReadVisregArtifactsOptions {
  resultsRoot: string;
  slug: string;
  viewport: Viewport;
}

export interface VisregArtifactSet {
  artifacts: VisregArtifact[];
}

/**
 * Reads the per-test visreg report.json for a single (slug, viewport) and
 * returns stage artifacts. Returns null if no report.json exists for
 * that pair — typically means the test wasn't measured at this viewport
 * (either the shard didn't run it or visreg filtered it out).
 */
export async function readVisregArtifacts(opts: ReadVisregArtifactsOptions): Promise<VisregArtifactSet | null> {
  const { resultsRoot, slug, viewport } = opts;
  const perTestDir = path.join(resultsRoot, slug, 'artifacts');
  const reportPath = path.join(perTestDir, 'report.json');
  if (!fs.existsSync(reportPath)) return null;

  let report: VisregPerTestReport;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as VisregPerTestReport;
  } catch (err) {
    throw new Error(
      `visreg report.json unreadable at ${reportPath}: ${(err as Error).message}`,
    );
  }

  const artifacts: VisregArtifact[] = [];

  for (const entry of report.tests ?? []) {
    const pair = entry.pair;
    // visreg serialises misMatchPercentage as a string ("0.00") — coerce to
    // number so the React renderer can format it.
    const misMatchPercentage = coerceNumber(pair.diff?.misMatchPercentage);
    const threshold = pair.misMatchThreshold ?? 0.1;

    // Prefer the pixelmatch diff (transparent BG, red changed pixels — clear
    // at thumbnail size). Fall back to resemble's failed_diff overlay.
    const diffSource = pair.pixelmatchDiffImage ?? pair.diffImage ?? null;
    // Only the pixelmatch PNG has the red/yellow highlight semantics the
    // bbox scanner relies on — resemble's overlay is full-opacity colored
    // so the grayscale detector would misclassify it.
    const controlDims = pair.reference ? readPngDims(resolveUnderBase(perTestDir, pair.reference)) : null;
    const experimentDims = pair.test ? readPngDims(resolveUnderBase(perTestDir, pair.test)) : null;
    const scan = pair.pixelmatchDiffImage
      ? scanDiffPng(
          resolveUnderBase(perTestDir, pair.pixelmatchDiffImage),
          controlDims,
          experimentDims,
          viewport,
        )
      : null;

    const [controlImage, experimentImage, diffImage] = await Promise.all([
      toDataUri(perTestDir, pair.reference),
      toDataUri(perTestDir, pair.test),
      diffSource ? toDataUri(perTestDir, diffSource) : Promise.resolve(null),
    ]);

    artifacts.push({
      selector: pair.selector ?? 'document',
      controlImage,
      experimentImage,
      diffImage,
      misMatchPercentage,
      diffPixels: scan?.diffPixels ?? 0,
      threshold,
      diffBbox: scan?.bbox ?? null,
      savedByRetries: pair.savedByRetries ?? false,
    });
  }

  return {
    artifacts,
  };
}

function resolveUnderBase(baseDir: string, relOrAbs: string): string {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(baseDir, relOrAbs);
}

async function toDataUri(baseDir: string, relOrAbs?: string | null): Promise<string> {
  if (!relOrAbs) return '';
  const absPath = resolveUnderBase(baseDir, relOrAbs);
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
    return bufferToAvifDataUri(
      fs.readFileSync(absPath),
      VISREG_AVIF_QUALITY,
      VISREG_IMAGE_SCALE,
    );
  }
  return embedAsBase64(absPath) ?? '';
}
