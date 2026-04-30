import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { embedAsBase64 } from 'shaka-shared';
import type { CategoryResult, VisregArtifact } from '../report';
import { bufferToWebpDataUri } from './compress-inlined';

const VISREG_WEBP_QUALITY = 80;

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
 *
 * We use the full `[first_diff_row, last_diff_row]` span (not just the
 * first contiguous block) because pixelmatch pads the shorter source to
 * `max(control, experiment)`: if layout shifts push e.g. the footer lower
 * in one screenshot, the "same" altered content shows up at different Y
 * coordinates in the two sources, and we need the crop to cover both so
 * the text is visible in every panel of the triplet.
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
  // flush against the edge of the first diff pixel — gives the thumbnail
  // a bit of breathing room without including a whole new line below.
  const PAD = 5;
  const padTop = Math.min(PAD, y0);
  const padLeft = Math.min(PAD, minX);
  const padRight = Math.min(PAD, width - (maxX + 1));

  let cropX = minX - padLeft;
  let cropY = y0 - padTop;
  let cropW = rawW + padLeft + padRight;
  let cropH = rawH + padTop;

  // A footer-style one-line diff would otherwise render as a 200-px-wide,
  // 6-px-tall strip — useless at thumbnail size. Clamp the crop aspect ratio
  // to at most 4:1 (wide:tall) and 1:4 (tall:wide) by padding the short axis
  // around the diff, staying inside the source image.
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

function coerceNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

interface VisregReport {
  testSuite?: string;
  tests?: Array<{ pair: VisregPair; status?: string }>;
}

/**
 * Groups visreg pairs from <htmlReportDir>/report.json by scenario label
 * (which matches the abTest() name used by convertAbTestToScenario).
 */
export async function harvestVisreg(htmlReportDir: string): Promise<Map<string, CategoryResult>> {
  const reportPath = path.join(htmlReportDir, 'report.json');
  const out = new Map<string, CategoryResult>();
  if (!fs.existsSync(reportPath)) return out;

  let report: VisregReport;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as VisregReport;
  } catch (err) {
    throw new Error(
      `visreg report.json unreadable at ${reportPath}: ${(err as Error).message}`,
    );
  }

  const byLabel = new Map<string, VisregArtifact[]>();
  const errorsByLabel = new Map<string, string[]>();
  for (const entry of report.tests ?? []) {
    const pair = entry.pair;
    const label = pair.label;
    if (!label) continue;

    // visreg serialises misMatchPercentage as a string ("0.00") — coerce to
    // number so the React renderer can format it.
    const misMatchPercentage = coerceNumber(pair.diff?.misMatchPercentage);
    const threshold = pair.misMatchThreshold ?? 0.1;
    const pairErrorMsg = pair.error ?? pair.engineErrorMsg ?? null;
    if (pairErrorMsg) {
      const list = errorsByLabel.get(label) ?? [];
      list.push(`[${pair.viewportLabel ?? '?'}] ${pairErrorMsg}`);
      errorsByLabel.set(label, list);
    }

    // Prefer the pixelmatch diff (transparent BG, red changed pixels — clear
    // at thumbnail size). Fall back to resemble's failed_diff overlay.
    const diffSource = pair.pixelmatchDiffImage ?? pair.diffImage ?? null;
    // `changed` drives the test-level `visual_change` pill; the per-row diff
    // chip in VisregSlot keys off `diffImage !== null`. Derive both from the
    // same signal — the presence of a diff PNG — so the pill never
    // disagrees with the chip it sits above. Per-pair errors (selector not
    // found, reference missing, engine crash on one viewport) used to
    // bubble into `changed` too, which surfaced them as a phantom
    // `visual_change` pill without any visible chip; they now flow through
    // `category.error` instead so they show up as an error banner + pill.
    const changed = diffSource !== null;
    // Only the pixelmatch PNG has the red/yellow highlight semantics the bbox
    // scanner relies on — resemble's overlay is full-opacity colored so the
    // grayscale detector would misclassify it.
    const controlDims = pair.reference ? readPngDims(resolveUnderBase(htmlReportDir, pair.reference)) : null;
    const experimentDims = pair.test ? readPngDims(resolveUnderBase(htmlReportDir, pair.test)) : null;
    const scan = pair.pixelmatchDiffImage
      ? scanDiffPng(
          resolveUnderBase(htmlReportDir, pair.pixelmatchDiffImage),
          controlDims,
          experimentDims,
        )
      : null;
    const [controlImage, experimentImage, diffImage] = await Promise.all([
      toDataUri(htmlReportDir, pair.reference),
      toDataUri(htmlReportDir, pair.test),
      diffSource ? toDataUri(htmlReportDir, diffSource) : Promise.resolve(null),
    ]);
    const artifact: VisregArtifact = {
      viewportLabel: pair.viewportLabel ?? '',
      selector: pair.selector ?? 'document',
      controlImage,
      experimentImage,
      diffImage,
      misMatchPercentage,
      diffPixels: scan?.diffPixels ?? 0,
      threshold,
      diffBbox: scan?.bbox ?? null,
    };

    // tag the "changed" bit onto the artifact via a sentinel so the grouping
    // step below can compute category status without re-reading pair.error
    (artifact as VisregArtifact & { _changed?: boolean })._changed = changed;

    const list = byLabel.get(label) ?? [];
    list.push(artifact);
    byLabel.set(label, list);
  }

  for (const [label, artifacts] of byLabel) {
    const anyChanged = artifacts.some(
      (a) => (a as VisregArtifact & { _changed?: boolean })._changed,
    );
    // scrub the sentinel before emitting
    for (const a of artifacts) {
      delete (a as VisregArtifact & { _changed?: boolean })._changed;
    }
    const pairErrors = errorsByLabel.get(label);
    const result: CategoryResult = {
      category: 'visreg',
      status: anyChanged ? 'visual_change' : 'no_difference',
      visreg: artifacts,
    };
    if (pairErrors && pairErrors.length > 0) {
      result.error = pairErrors.length === 1
        ? pairErrors[0]
        : `${pairErrors.length} pair(s) errored: ${pairErrors.join('; ')}`;
    }
    out.set(label, result);
  }
  return out;
}

function resolveUnderBase(baseDir: string, relOrAbs: string): string {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(baseDir, relOrAbs);
}

async function toDataUri(baseDir: string, relOrAbs?: string | null): Promise<string> {
  if (!relOrAbs) return '';
  const abs = resolveUnderBase(baseDir, relOrAbs);
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    try {
      return await bufferToWebpDataUri(fs.readFileSync(abs), VISREG_WEBP_QUALITY);
    } catch {
      return '';
    }
  }
  return embedAsBase64(abs) ?? '';
}
