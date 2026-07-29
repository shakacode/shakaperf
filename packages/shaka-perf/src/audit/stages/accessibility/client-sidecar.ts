/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// Per-page sidecar the client report reads: a Lighthouse `score` (written here,
// from the audit's LH run) plus `summary`/`fixes` (written later by the AI pass).
// Writes MERGE, never clobber, so the two passes are order-independent.
export interface A11yClientSidecar {
  score?: number;
  summary?: string;
  fixes?: string[];
  // Preserve unknown keys a future pass may add (lossless merge).
  [key: string]: unknown;
}

export const ACCESSIBILITY_CLIENT_FILENAME = 'accessibility-client.json';
// Site-level sidecar at the results root: one summary across all pages.
export const ACCESSIBILITY_SITE_FILENAME = 'accessibility-site.json';

// Set the rounded /100 score, preserving every existing field. Pure (testable);
// writeAccessibilityClientScore does the read/merge/write.
export function mergeA11yClientScore(
  existing: A11yClientSidecar | undefined,
  score: number,
): A11yClientSidecar {
  return { ...(existing ?? {}), score: Math.round(score) };
}

// Set summary + fixes, preserving every existing field (chiefly the audit-time
// score) so the score pass and summary pass are order-independent. Pure (testable).
export function mergeA11yClientSummary(
  existing: A11yClientSidecar | undefined,
  payload: { summary: string; fixes: string[] },
): A11yClientSidecar {
  return { ...(existing ?? {}), summary: payload.summary, fixes: payload.fixes };
}

// Read the existing sidecar losslessly (raw object, all keys kept). Anything
// not a plain JSON object - missing file, parse error, array/primitive - counts
// as "no sidecar yet". The reader validates field types, so raw storage is safe.
function readSidecar(filePath: string): A11yClientSidecar | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as A11yClientSidecar;
}

// Write the score into <unitDir>/accessibility-client.json (the dir the client
// report reads), merging to keep any AI summary/fixes. Skips a non-finite score.
export function writeAccessibilityClientScore(unitDir: string, score: number): void {
  if (!Number.isFinite(score)) return;
  const filePath = path.join(unitDir, ACCESSIBILITY_CLIENT_FILENAME);
  const merged = mergeA11yClientScore(readSidecar(filePath), score);
  try {
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  } catch (err) {
    // A side lens: a write failure must not fail the audit / lose the perf data.
    console.warn(
      `[shaka-perf a11y] could not write ${ACCESSIBILITY_CLIENT_FILENAME}: ${(err as Error).message}`,
    );
  }
}

// Write summary + fixes, merging to keep the score. Best-effort like the score writer.
export function writeAccessibilityClientSummary(
  unitDir: string,
  payload: { summary: string; fixes: string[] },
): void {
  const filePath = path.join(unitDir, ACCESSIBILITY_CLIENT_FILENAME);
  const merged = mergeA11yClientSummary(readSidecar(filePath), payload);
  try {
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  } catch (err) {
    console.warn(
      `[shaka-perf a11y] could not write ${ACCESSIBILITY_CLIENT_FILENAME}: ${(err as Error).message}`,
    );
  }
}

// Write the site-level summary to <resultsDir>/accessibility-site.json (lossless merge).
export function writeAccessibilitySiteSummary(resultsDir: string, summary: string): void {
  const filePath = path.join(resultsDir, ACCESSIBILITY_SITE_FILENAME);
  const merged = { ...(readSidecar(filePath) ?? {}), summary };
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  } catch (err) {
    console.warn(
      `[shaka-perf a11y] could not write ${ACCESSIBILITY_SITE_FILENAME}: ${(err as Error).message}`,
    );
  }
}
