/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The raw istanbul map, under the name the `shaka-perf-coverage` skill's
 * `view-coverage.js` reads (`<results>/<unit>/artifacts/coverage.json`).
 */
export const COVERAGE_FILENAME = 'coverage.json';

export interface CoverageSummary {
  files: number;
  coveredStatements: number;
  totalStatements: number;
}

/**
 * Reduce an istanbul coverage object (`{ [absFile]: { s: { [stmtId]: hits } } }`)
 * to the counts the report shows. Malformed entries are skipped rather than
 * throwing: the shape comes from whatever instrumented the user's bundle.
 */
export function summarizeCoverage(raw: unknown): CoverageSummary {
  let files = 0;
  let coveredStatements = 0;
  let totalStatements = 0;
  if (raw && typeof raw === 'object') {
    for (const fileCoverage of Object.values(raw as Record<string, unknown>)) {
      if (!fileCoverage || typeof fileCoverage !== 'object') continue;
      const hits = (fileCoverage as { s?: unknown }).s;
      if (!hits || typeof hits !== 'object') continue;
      files += 1;
      for (const count of Object.values(hits as Record<string, unknown>)) {
        totalStatements += 1;
        if (typeof count === 'number' && count > 0) coveredStatements += 1;
      }
    }
  }
  return { files, coveredStatements, totalStatements };
}

/**
 * Copy one unit's coverage under a unique name in `<results>/.nyc_output/`.
 * nyc keys FileCoverage entries by absolute path and SUMS hit counts per
 * location when merging, so the per-(test, viewport) copies aggregate into one
 * report where a statement any test hit counts as covered.
 */
export function mirrorCoverageToNycOutput(
  coveragePath: string,
  resultsRoot: string,
  key: string,
): void {
  const nycDir = path.join(resultsRoot, '.nyc_output');
  fs.mkdirSync(nycDir, { recursive: true });
  const slug = key.replace(/[^a-zA-Z0-9._-]+/g, '_');
  fs.copyFileSync(coveragePath, path.join(nycDir, `${slug}.json`));
}
