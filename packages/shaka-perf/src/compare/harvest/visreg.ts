import * as fs from 'fs';
import * as path from 'path';
import { embedAsBase64 } from 'shaka-shared';
import type { CategoryResult, VisregArtifact } from '../report';

interface VisregPair {
  reference?: string;
  test?: string;
  diffImage?: string | null;
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

    const artifact: VisregArtifact = {
      viewportLabel: pair.viewportLabel ?? '',
      selector: pair.selector ?? 'document',
      controlImage: toDataUri(htmlReportDir, pair.reference),
      experimentImage: toDataUri(htmlReportDir, pair.test),
      diffImage: pair.diffImage ? toDataUri(htmlReportDir, pair.diffImage) : null,
      misMatchPercentage,
      diffPixels: 0,
      threshold,
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

function toDataUri(baseDir: string, relOrAbs?: string | null): string {
  if (!relOrAbs) return '';
  const resolved = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(baseDir, relOrAbs);
  return embedAsBase64(resolved) ?? '';
}
