import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { embedAsBase64 } from 'shaka-shared';
import type { CategoryResult, VisregArtifact } from '../report';

type DiffBbox = NonNullable<VisregArtifact['diffBbox']>;

/**
 * Scan a pixelmatch-generated diff PNG for the first contiguous block of
 * non-grayscale (i.e. highlighted) pixels. Matching pixels are rendered
 * grayscale by pixelmatch; diff pixels are red, AA pixels are yellow —
 * both satisfy r!==g || g!==b.
 *
 * Returns the bounding box of that first block in source-image pixels, or
 * `null` if the PNG can't be read / contains no diff pixels. A small vertical
 * gap (<=8 rows of no-diff pixels) is tolerated before the block closes, so
 * that a single button or heading with internal whitespace is captured as
 * one region.
 */
function computeDiffBbox(absPath: string): DiffBbox | null {
  let png: PNG;
  try {
    png = PNG.sync.read(fs.readFileSync(absPath));
  } catch {
    return null;
  }
  const { data, width, height } = png;
  if (width === 0 || height === 0) return null;

  const isDiffPixel = (i: number): boolean =>
    data[i] !== data[i + 1] || data[i + 1] !== data[i + 2];

  let y0 = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isDiffPixel((y * width + x) * 4)) {
        y0 = y;
        break outer;
      }
    }
  }
  if (y0 < 0) return null;

  let minX = width;
  let maxX = 0;
  let y1 = y0;
  let gap = 0;
  for (let y = y0; y < height; y++) {
    let foundInRow = false;
    for (let x = 0; x < width; x++) {
      if (isDiffPixel((y * width + x) * 4)) {
        foundInRow = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (foundInRow) {
      y1 = y;
      gap = 0;
    } else if (++gap > 8) {
      break;
    }
  }

  const rawW = Math.max(1, maxX - minX + 1);
  const rawH = Math.max(1, y1 - y0 + 1);

  // A footer-style one-line diff would otherwise render as a 200-px-wide,
  // 6-px-tall strip — useless at thumbnail size. Clamp the crop aspect ratio
  // to at most 4:1 (wide:tall) and 1:4 (tall:wide) by padding the short axis
  // around the diff, staying inside the source image.
  const MAX_RATIO = 4;
  let cropX = minX;
  let cropY = y0;
  let cropW = rawW;
  let cropH = rawH;
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
    imgH: height,
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
    const diffBbox = pair.pixelmatchDiffImage
      ? computeDiffBbox(resolveUnderBase(htmlReportDir, pair.pixelmatchDiffImage))
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
