/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Page as PlaywrightPage, BrowserContext, Browser } from 'playwright';
import type { Viewport as SharedViewport } from 'shaka-shared';

export type { PlaywrightPage, BrowserContext, Browser };

// ── Viewport ────────────────────────────────────────────────────────
// Extends shaka-shared so the same object survives the trip into
// TestFnContext (which the user's test function receives) without
// losing `formFactor` / `deviceScaleFactor`.
export interface Viewport extends SharedViewport {
  vIndex?: number;
}

// ── Scenario ────────────────────────────────────────────────────────
// Ready-waits, interactions, and DOM manipulation are the test body's job —
// the scenario carries no declarative fields for them.
export interface Scenario {
  label: string;
  url: string;
  referenceUrl?: string;

  // Selectors to capture
  selectors?: string[];
  selectorExpansion?: boolean;

  // Comparison tuning is NOT carried on the scenario — it lives on the effective
  // `config.visreg` (file defaults + `test.config.visreg`), written into the
  // engine's bridge config by the compare stage.

  // Internal (set at runtime)
  sIndex?: number;
  _testFn?: (context: import('shaka-shared').TestFnContext) => Promise<void>;
  _testDef?: import('shaka-shared').AbTestDefinition;
}

// ── Engine Options (Playwright) ─────────────────────────────────────
export interface EngineOptions {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  ignoreDefaultArgs?: string[];
  args?: string[];
  ignoreHTTPSErrors?: boolean;
  gotoParameters?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
    timeout?: number;
    referer?: string;
  };
  waitTimeout?: number;
  [key: string]: any;
}

// ── Resemble Output Options ─────────────────────────────────────────
export interface ResembleOutputOptions {
  transparency?: number;
  ignoreAntialiasing?: boolean;
  usePreciseMatching?: boolean;
  [key: string]: any;
}

// ── Paths ───────────────────────────────────────────────────────────
export interface VisregPaths {
  /**
   * The one dir this invocation writes into — report.json, the moved PNGs, and
   * the accumulated frame subdirs all live beneath it. Required: the caller
   * (the compare stage) hands over the artifacts dir the framework resolved for
   * this unit, and reads the results back from it. The caller says WHERE; the
   * engine owns the layout underneath.
   */
  artifacts: string;
}

// ── User Config ───────────────────────────────────────────────────
// Exactly what the compare stage's bridge config can carry: the zod `visreg`
// slice of `abtests.config.ts` plus the engine-plumbing fields the runner
// writes (`paths`, the async limits). Nothing else — the engine has no other
// config source.
export interface VisregConfig {
  viewports: Viewport[];
  scenarios: Scenario[];
  paths?: VisregPaths;

  engineOptions?: EngineOptions;

  asyncCaptureLimit?: number;
  asyncCompareLimit?: number;

  mismatchThreshold?: number;
  resembleOutputOptions?: ResembleOutputOptions;

  compareRetries?: number;
  compareRetryDelay?: number;
  maxNumDiffPixels?: number;

  // compare
  comparePixelmatchThreshold?: number;
}

// ── Runtime Config (internal, after makeConfig + extendConfig) ───────
export interface RuntimeConfig {
  args: Record<string, unknown>;
  projectPath: string;

  configFileName: string;
  /** `paths.artifacts` — the dir this invocation writes everything into. */
  unitArtifactsDir: string;
  /** `<unitArtifactsDir>/control_screenshots`. */
  controlScreenshotDir: string;
  /** `<unitArtifactsDir>/experiment_screenshots`. */
  experimentScreenshotDir: string;
  tempCompareConfigFileName: string;

  mismatchThreshold: number;
  resembleOutputOptions?: ResembleOutputOptions;
  asyncCompareLimit?: number;
  viewports: Viewport[];

  compareRetries: number;
  compareRetryDelay: number;
  maxNumDiffPixels: number;
}

// ── Decorated Compare Config (internal, used during compare) ─────
export interface DecoratedCompareConfig extends VisregConfig {
  env: RuntimeConfig;
  // The four comparison-tuning values the compare stage writes into the bridge
  // config from the effective `config.visreg` (zod defaults + per-test merge
  // already applied), so the engine reads them straight.
  mismatchThreshold: number;
  requireSameDimensions: boolean;
  maxNumDiffPixels: number;
  comparePixelmatchThreshold: number;
  configFileName: string;
  compareRetries: number;
  compareRetryDelay: number;
}

// ── Diff Result (from resemble.js comparison) ───────────────────────
export interface DiffResult {
  misMatchPercentage: number;
  rawMisMatchPercentage?: number;
  isSameDimensions: boolean;
  dimensionDifference?: { width: number; height: number };
  [key: string]: unknown;
}

// ── Test Pair ───────────────────────────────────────────────────────
export interface TestPair {
  reference: string;
  test: string;
  selector: string;
  fileName: string;
  label: string;
  requireSameDimensions: boolean;
  mismatchThreshold: number;
  url: string;
  referenceUrl?: string;
  viewportLabel: string;
  diff?: DiffResult;
  refWhitePixelPercent?: number;
  testWhitePixelPercent?: number;
  refIsBottomSeventyPercentWhite?: boolean;
  testIsBottomSeventyPercentWhite?: boolean;
  diffImage?: string;
  pixelmatchDiffImage?: string;
  error?: string;
  /**
   * True when this comparison initially mismatched but a later retry matched —
   * i.e. the test was visually flaky yet recovered. Surfaced in the report as
   * the "Flaky (saved by retries)" chip.
   */
  savedByRetries?: boolean;
  status?: string;
  testFile?: string;
  testLine?: number;
}

// ── Compare Config ──────────────────────────────────────────────────
export interface CompareConfig {
  testPairs: TestPair[];
}

// ── Visreg Tools (injected into browser window) ──────────────────
export interface VisregTools {
  expandSelectors: (selectors: string[] | string) => string[];
  exists: (selector: string) => number;
  isVisible: (selector: string) => boolean;
}

// ── Engine Input Config ─────────────────────────────────────────────
// What the compare runner's engine-bridge writes into a temp `.js`
// file for the visreg engine to pick up. Structurally the `visreg`
// slice of the unified `abtests.config.ts` (from `shaka-perf/compare`)
// plus the engine-plumbing fields the runner writes (`paths`, the async
// limits on VisregConfig). This is an internal plumbing type — not a
// user-authored config.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { VisregConfig as _VisregConfigSlice } from '../../config';

export type VisregEngineInputConfig = Partial<_VisregConfigSlice> & {
  paths?: VisregPaths;
};
