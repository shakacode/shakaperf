import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { embedAsBase64 } from 'shaka-shared';
import type { TestType } from 'shaka-shared';
import type { CategoryResult, VisregArtifact } from '../report';
import type { AbTestsConfig, Viewport } from '../config';
import type { CategoryDef, HarvestContext } from '../category-def';
import { bufferToAvifDataUri } from './compress-inlined';

const VISREG_AVIF_QUALITY = 55;
const VISREG_IMAGE_SCALE = 0.75;
const VISREG_TEST_TYPE = 'visreg' as unknown as TestType;

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

/**
 * Scan a pixelmatch-generated diff PNG for the span of highlighted pixels
 * and the count of red (true-diff) pixels.
 *
 * Matching pixels are rendered grayscale; diff pixels are red, AA pixels
 * are yellow — both satisfy r!==g || g!==b (bbox uses that). For the pixel
 * count we narrow to red only (g===0) so anti-aliased edges don't inflate
 * the number.
 */
function scanDiffPng(
  diffPath: string,
  controlDims: { w: number; h: number } | null,
  experimentDims: { w: number; h: number } | null,
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
  let y1 = -1;
  let minX = width;
  let maxX = 0;
  let diffPixels = 0;
  for (let y = 0; y < height; y++) {
    let rowHasDiff = false;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (isHighlighted(i)) {
        rowHasDiff = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (isRedDiff(i)) diffPixels++;
      }
    }
    if (rowHasDiff) {
      if (y0 < 0) y0 = y;
      y1 = y;
    }
  }
  if (y0 < 0) return null;

  const rawW = Math.max(1, maxX - minX + 1);
  const rawH = Math.max(1, y1 - y0 + 1);

  // 5px gutter on top/left/right (not bottom) so the cropped region isn't
  // flush against the edge of the first diff pixel.
  const PAD = 5;
  const padTop = Math.min(PAD, y0);
  const padLeft = Math.min(PAD, minX);
  const padRight = Math.min(PAD, width - (maxX + 1));

  let cropX = minX - padLeft;
  let cropY = y0 - padTop;
  let cropW = rawW + padLeft + padRight;
  let cropH = rawH + padTop;

  // Clamp crop aspect ratio to at most 4:1 (wide:tall) and 1:4 (tall:wide)
  // so a one-line footer diff doesn't render as a useless strip at
  // thumbnail size.
  const MAX_RATIO = 4;
  if (cropW / cropH > MAX_RATIO) {
    const desiredH = Math.ceil(cropW / MAX_RATIO);
    const extra = desiredH - cropH;
    cropY = Math.max(0, cropY - Math.floor(extra / 2));
    cropH = Math.min(desiredH, height - cropY);
  } else if (cropH / cropW > MAX_RATIO) {
    const desiredW = Math.ceil(cropH / MAX_RATIO);
    const extra = desiredW - cropW;
    cropX = Math.max(0, cropX - Math.floor(extra / 2));
    cropW = Math.min(desiredW, width - cropX);
  }

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
}

interface VisregPerTestReport {
  testSuite?: string;
  tests?: Array<{ pair: VisregPair; status?: string }>;
  /**
   * Unified engine-error payload written by the bridge reslicer —
   * short message + full transcript of pair-level errors. Perf writes
   * the same shape via `foldEngineArtifactsIntoReport`. Reading one
   * shape = one dialog in the UI.
   */
  engineError?: string;
  engineOutput?: string;
}

function coerceNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export interface HarvestVisregOptions {
  resultsRoot: string;
  slug: string;
  viewport: Viewport;
}

/**
 * Compact result of reading one test's visreg output at one viewport.
 * The assembler in `run.ts` stitches these together across viewports into
 * a single `CategoryResult` per test, mirroring how perf merges N per-
 * viewport `PerfArtifact` objects into its `artifacts` array.
 */
export interface HarvestedVisreg {
  artifacts: VisregArtifact[];
  /** Any pair in this viewport had a pixel diff PNG (→ visual change). */
  hasChange: boolean;
  /**
   * Short, one-line engine error message for this viewport (or null).
   * Mirrors `PerfArtifact.error`; the shared `SlotError` component
   * renders this as a clickable banner.
   */
  engineError: string | null;
  /**
   * Full engine transcript for the "view logs" dialog — a pair-by-pair
   * error dump assembled by the bridge reslicer. Same dialog is opened
   * for perf's stdout/stderr transcript.
   */
  engineOutput: string | null;
}

function visregRootFor(resultsRoot: string, viewportLabel: string): string {
  return path.join(resultsRoot, `visreg-${viewportLabel}`);
}

/**
 * Reads the per-test visreg report.json for a single (slug, viewport) and
 * returns harvested artifacts. Returns null if no report.json exists for
 * that pair — typically means the test wasn't measured at this viewport
 * (either the shard didn't run it or visreg filtered it out).
 */
export async function harvestVisreg(opts: HarvestVisregOptions): Promise<HarvestedVisreg | null> {
  const { resultsRoot, slug, viewport } = opts;
  const perTestDir = path.join(visregRootFor(resultsRoot, viewport.label), slug);
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
  let hasChange = false;

  for (const entry of report.tests ?? []) {
    const pair = entry.pair;
    // visreg serialises misMatchPercentage as a string ("0.00") — coerce to
    // number so the React renderer can format it.
    const misMatchPercentage = coerceNumber(pair.diff?.misMatchPercentage);
    const threshold = pair.misMatchThreshold ?? 0.1;

    // Prefer the pixelmatch diff (transparent BG, red changed pixels — clear
    // at thumbnail size). Fall back to resemble's failed_diff overlay.
    const diffSource = pair.pixelmatchDiffImage ?? pair.diffImage ?? null;
    // `changed` drives the test-level `visual_change` pill; per-pair errors
    // flow through the shared engineError/engineOutput fields at the
    // top of the report instead, so they surface as an error banner + pill
    // rather than a phantom change chip.
    const changed = diffSource !== null;
    if (changed) hasChange = true;

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
        )
      : null;

    const [controlImage, experimentImage, diffImage] = await Promise.all([
      toDataUri(perTestDir, pair.reference),
      toDataUri(perTestDir, pair.test),
      diffSource ? toDataUri(perTestDir, diffSource) : Promise.resolve(null),
    ]);

    artifacts.push({
      viewportLabel: pair.viewportLabel ?? viewport.label,
      selector: pair.selector ?? 'document',
      controlImage,
      experimentImage,
      diffImage,
      misMatchPercentage,
      diffPixels: scan?.diffPixels ?? 0,
      threshold,
      diffBbox: scan?.bbox ?? null,
    });
  }

  return {
    artifacts,
    hasChange,
    engineError: report.engineError ?? null,
    engineOutput: report.engineOutput ?? null,
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

async function harvestVisregCategory(ctx: HarvestContext): Promise<CategoryResult | null> {
  const { slug, viewports, resultsRoot } = ctx;
  const artifacts: VisregArtifact[] = [];
  const viewportErrors: string[] = [];
  const viewportLogs: string[] = [];
  let anyChange = false;
  let anyHarvested = false;

  for (const viewport of viewports) {
    const harvested = await harvestVisreg({ resultsRoot, slug, viewport });
    if (!harvested) continue;
    anyHarvested = true;
    artifacts.push(...harvested.artifacts);
    if (harvested.hasChange) anyChange = true;
    if (harvested.engineError) {
      viewportErrors.push(`[${viewport.label}] ${harvested.engineError}`);
    }
    if (harvested.engineOutput) {
      viewportLogs.push(`── ${viewport.label} ──\n${harvested.engineOutput}`);
    }
  }

  if (!anyHarvested) return null;

  const error = viewportErrors.length === 0
    ? undefined
    : viewportErrors.length === 1
      ? viewportErrors[0]
      : `${viewportErrors.length} viewport(s) errored: ${viewportErrors.join('; ')}`;
  const errorLog = viewportLogs.length === 0 ? undefined : viewportLogs.join('\n\n');

  return {
    testType: 'visreg',
    status: anyChange ? 'visual_change' : 'no_difference',
    artifacts,
    ...(error ? { error } : {}),
    ...(errorLog ? { errorLog } : {}),
  };
}

export const visregCategoryDef: CategoryDef = {
  testType: VISREG_TEST_TYPE,
  viewports: (config: AbTestsConfig) => config.visreg.viewports,
  harvest: harvestVisregCategory,
};
