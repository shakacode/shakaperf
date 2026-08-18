/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import {
  type JsonValue,
  type Stage,
  type StageName,
  type StageRenderEntry,
  type TestContext,
} from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import { CodeCoverageArtifactView } from './report';

export interface CodeCoverageResult {
  /** Instrumented files this test loaded. */
  files: number;
  /** Statements it executed, across those files. */
  coveredStatements: number;
  /** Statements the instrumentation knows about in those files. */
  totalStatements: number;
  /** Report-relative path to the raw istanbul `coverage.json`. */
  coverageHref?: string;
  /**
   * Report-relative path to the screenshot-coverage map: every element of the
   * finished page with its box and the share of it that falls inside this
   * test's `visregSelectors`. Absent only when the snapshot itself failed.
   */
  visibilityMapHref?: string;
}

/**
 * The one stage that measures COVERAGE, in both senses, off one finished page:
 *
 *   - code coverage — `window.__coverage__` (babel-plugin-istanbul /
 *     `nyc instrument`), answering "which test executed this line";
 *   - screenshot coverage — the visibility map, answering "did the element
 *     that line rendered end up inside this test's `visregSelectors`".
 *
 * They only mean anything together, so they are taken together: same browser,
 * same page state, same moment — and a page with no `window.__coverage__`
 * fails the unit rather than reporting half of it.
 * There is no config switch — the CATEGORY is
 * the switch (`shaka-perf audit --categories code_coverage`), and it is not in
 * the default category set because it re-runs every test body in a second
 * browser. That browser is set up from the `visreg` section — its launch
 * options, its viewports, and the test's own `visregSelectors` — so what it
 * measures is exactly the rendering visreg screenshots. It deliberately does NOT ride the Lighthouse
 * gather: draining a whole coverage object and walking the DOM inside a
 * measured window would tax the numbers the audit exists to report, which is
 * why the audit stage collects only Lighthouse and video.
 */
export class CodeCoverageStage implements Stage<CodeCoverageResult> {
  readonly category = 'code_coverage';
  readonly name: StageName = 'code_coverage';
  readonly label = 'Code Coverage';
  readonly description = 'Run each test body in a visreg-configured browser, drain its instrumented JS coverage, and map what the finished page shows inside the capture region.';
  readonly selfContainedReportStrip = {
    coverageHref: true,
    visibilityMapHref: true,
  };

  applies(): boolean {
    // Selecting the category IS the opt-in; a test opts out the same way it
    // opts out of any other category, with `testTypes`.
    return true;
  }

  async run(ctx: TestContext, pool: WorkerPool): Promise<CodeCoverageResult> {
    const runImpl = './engine';
    const { runCodeCoverageStage } = await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    return runCodeCoverageStage(ctx, pool);
  }

  renderArtifacts(measurements: readonly StageRenderEntry<CodeCoverageResult>[]) {
    return createElement(CodeCoverageArtifactView, { measurements });
  }

  // report.json carries this summary, not the raw measurement — it is how a
  // downstream tool (the `shaka-perf-coverage` skill) finds the two artifacts
  // without opening every per-unit outcome file.
  machineReadableSummary(measurement: CodeCoverageResult): JsonValue {
    return {
      files: measurement.files,
      coveredStatements: measurement.coveredStatements,
      totalStatements: measurement.totalStatements,
      ...(measurement.coverageHref ? { coverageHref: measurement.coverageHref } : {}),
      ...(measurement.visibilityMapHref ? { visibilityMapHref: measurement.visibilityMapHref } : {}),
    };
  }
}
