/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';
import type { AbTestDefinition, Viewport } from 'shaka-shared';
import { ArtifactStore } from '../../pipeline/artifact-store';
import type { TestResult } from '../../pipeline/report';
import { testIdForTest } from '../../pipeline/unit-id';
import { resolveUrl } from '../../pipeline/unit-urls';
import type { BisectCategory } from './types';
import type { CompareRunResult } from './run-candidate';

export interface LoadReusableCompareResultsOptions {
  cwd: string;
  tests: readonly AbTestDefinition[];
  categories: readonly BisectCategory[];
  controlURL: string;
  experimentURL: string;
  viewports: Partial<Record<BisectCategory, readonly Viewport[]>>;
}

export function loadReusableCompareResults(
  options: LoadReusableCompareResultsOptions,
): CompareRunResult {
  const compareResultsPath = path.resolve(options.cwd, 'compare-results');
  const store = new ArtifactStore(compareResultsPath);
  const outcomeCounts = new Map(options.categories.map((category) => [category, 0]));
  const testResults = options.tests.map((test) => loadTestResult(
    options,
    store,
    test,
    outcomeCounts,
  ));

  for (const category of options.categories) {
    if ((outcomeCounts.get(category) ?? 0) > 0) continue;
    throw new Error(
      `Cannot reuse current compare results: no persisted ${category} outcomes were found in ` +
        `${compareResultsPath}. Run shaka-perf compare --categories ${category} first.`,
    );
  }

  return { testResults, compareResultsPath };
}

function loadTestResult(
  options: LoadReusableCompareResultsOptions,
  store: ArtifactStore,
  test: AbTestDefinition,
  outcomeCounts: Map<BisectCategory, number>,
): TestResult {
  const outcomes = options.categories.flatMap((category) => (
    (options.viewports[category] ?? []).flatMap((viewport) => {
      const outcome = store.readOutcome(test, viewport.label, category);
      if (!outcome) return [];
      outcomeCounts.set(category, (outcomeCounts.get(category) ?? 0) + 1);
      return [{ ...outcome, viewport }];
    })
  ));
  const viewportLabels = new Set(outcomes.map((outcome) => outcome.viewport.label));

  return {
    id: testIdForTest(test),
    name: test.name,
    filePath: test.file ? path.relative(options.cwd, test.file) : '(unknown source)',
    startingPath: test.startingPath,
    controlUrl: resolveUrl(
      test.startingPath,
      test.config?.shared?.controlURL ?? options.controlURL,
    ),
    experimentUrl: resolveUrl(
      test.experimentPathOverride ?? test.startingPath,
      test.config?.shared?.experimentURL ?? options.experimentURL,
    ),
    code: null,
    chips: [],
    sorts: [],
    durationMs: 0,
    measuredAt: null,
    runId: null,
    outcomes,
    viewportArtifactPaths: [...viewportLabels].map((viewport) => ({
      viewport,
      path: store.unitDirForViewport(test, viewport),
    })),
  };
}
