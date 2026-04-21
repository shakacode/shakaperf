import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { embedAsBase64 } from 'shaka-shared';
import type { CategoryResult, VisregArtifact } from '../report';

type DiffBbox = NonNullable<VisregArtifact['diffBbox']>;

function readPngDims(absPath: string): { w: number; h: number } | null {
  try {
    const png = PNG.sync.read(fs.readFileSync(absPath));
    return { w: png.width, h: png.height };
  } catch {
    return null;
  }
}

/**
 * Scan a pixelmatch-generated diff PNG for the span of highlighted pixels.
 * Matching pixels are rendered grayscale; diff pixels are red, AA pixels
 * are yellow — both satisfy r!==g || g!==b.
 *
 * We use the full `[first_diff_row, last_diff_row]` span (not just the
 * first contiguous block) because pixelmatch pads the shorter source to
 * `max(control, experiment)`: if layout shifts push e.g. the footer lower
 * in one screenshot, the "same" altered content shows up at different Y
 * coordinates in the two sources, and we need the crop to cover both so
 * the text is visible in every panel of the triplet.
 */
function computeDiffBbox(
  diffPath: string,
  controlDims: { w: number; h: number } | null,
  experimentDims: { w: number; h: number } | null,
): DiffBbox | null {
  let png: PNG;
  try {
    png = PNG.sync.read(fs.readFileSync(diffPath));
  } catch {
    return null;
  }
  const { data, width, height } = png;
  if (width === 0 || height === 0) return null;

  const isDiffPixel = (i: number): boolean =>
    data[i] !== data[i + 1] || data[i + 1] !== data[i + 2];

  let y0 = -1;
  let y1 = -1;
  let minX = width;
  let maxX = 0;
  for (let y = 0; y < height; y++) {
    let rowHasDiff = false;
    for (let x = 0; x < width; x++) {
      if (isDiffPixel((y * width + x) * 4)) {
        rowHasDiff = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
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
    x: cropX,
    y: cropY,
    w: cropW,
    h: cropH,
    imgW: width,
    controlImgH: controlDims?.h ?? height,
    experimentImgH: experimentDims?.h ?? height,
    diffImgH: height,
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
export function harvestVisreg(htmlReportDir: string): Map<string, CategoryResult> {
  const reportPath = path.join(htmlReportDir, 'report.json');
  const out = new Map<string, CategoryResult>();
  if (!fs.existsSync(reportPath)) return out;

  let report: VisregReport;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as VisregReport;
  } catch {
    return out;
  }

  const byLabel = new Map<string, VisregArtifact[]>();
  for (const entry of report.tests ?? []) {
    const pair = entry.pair;
    const label = pair.label;
    if (!label) continue;

    // visreg serialises misMatchPercentage as a string ("0.00") — coerce to
    // number so the React renderer can format it.
    const misMatchPercentage = coerceNumber(pair.diff?.misMatchPercentage);
    const threshold = pair.misMatchThreshold ?? 0.1;
    const hasError = Boolean(pair.error ?? pair.engineErrorMsg);
    const changed = hasError || misMatchPercentage > threshold;

    // Prefer the pixelmatch diff (transparent BG, red changed pixels — clear
    // at thumbnail size). Fall back to resemble's failed_diff overlay.
    const diffSource = pair.pixelmatchDiffImage ?? pair.diffImage ?? null;
    // Only the pixelmatch PNG has the red/yellow highlight semantics the bbox
    // scanner relies on — resemble's overlay is full-opacity colored so the
    // grayscale detector would misclassify it.
    const controlDims = pair.reference ? readPngDims(resolveUnderBase(htmlReportDir, pair.reference)) : null;
    const experimentDims = pair.test ? readPngDims(resolveUnderBase(htmlReportDir, pair.test)) : null;
    const diffBbox = pair.pixelmatchDiffImage
      ? computeDiffBbox(
          resolveUnderBase(htmlReportDir, pair.pixelmatchDiffImage),
          controlDims,
          experimentDims,
        )
      : null;
    const artifact: VisregArtifact = {
      viewportLabel: pair.viewportLabel ?? '',
      selector: pair.selector ?? 'document',
      controlImage: toDataUri(htmlReportDir, pair.reference),
      experimentImage: toDataUri(htmlReportDir, pair.test),
      diffImage: diffSource ? toDataUri(htmlReportDir, diffSource) : null,
      misMatchPercentage,
      diffPixels: 0,
      threshold,
      diffBbox,
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
    out.set(label, {
      category: 'visreg',
      status: anyChanged ? 'visual_change' : 'no_difference',
      visreg: artifacts,
    });
  }
  return out;
}

function resolveUnderBase(baseDir: string, relOrAbs: string): string {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(baseDir, relOrAbs);
}

function toDataUri(baseDir: string, relOrAbs?: string | null): string {
  if (!relOrAbs) return '';
  return embedAsBase64(resolveUnderBase(baseDir, relOrAbs)) ?? '';
}
