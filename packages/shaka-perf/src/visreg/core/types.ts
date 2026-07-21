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
  viewport?: { width: number; height: number };
}

// ── Scenario ────────────────────────────────────────────────────────
export interface KeypressSelector {
  selector: string;
  keyPress: string | string[];
}

export interface Scenario {
  label: string;
  url: string;
  referenceUrl?: string;

  // Ready state
  readyEvent?: string;
  readySelector?: string;
  readyTimeout?: number;
  delay?: number;

  // DOM manipulation
  hideSelectors?: string[];
  removeSelectors?: string[];

  // Interactions
  hoverSelector?: string;
  hoverSelectors?: string[];
  clickSelector?: string;
  clickSelectors?: string[];
  keyPressSelectors?: KeypressSelector[];
  keyPressSelector?: KeypressSelector | KeypressSelector[];
  scrollToSelector?: string;
  postInteractionWait?: number | string;

  // Selectors to capture
  selectors?: string[];
  selectorExpansion?: boolean | string;

  // Viewport override
  viewports?: Viewport[];

  // Comparison
  misMatchThreshold?: number;
  requireSameDimensions?: boolean;

  // Engine options override
  engineOptions?: Partial<EngineOptions>;
  gotoParameters?: Record<string, any>;

  // Variants
  variants?: Variant[];

  // compare overrides
  compareRetries?: number;
  compareRetryDelay?: number;
  maxNumDiffPixels?: number;
  comparePixelmatchThreshold?: number;

  // Internal (set at runtime)
  sIndex?: number;
  _parent?: Scenario;
  _playwrightBrowser?: Browser;
  _testFn?: (context: import('shaka-shared').TestFnContext) => Promise<void>;
  _testDef?: import('shaka-shared').AbTestDefinition;
}

// ── Variant ─────────────────────────────────────────────────────────
export interface Variant {
  label: string;
  _parent?: Scenario;
  [key: string]: any;
}

// ── Engine Options (Playwright) ─────────────────────────────────────
export interface EngineOptions {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean | string;
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

// ── CI Report ───────────────────────────────────────────────────────
export interface CIReport {
  format: string;
  testReportFileName: string;
  testSuiteName: string;
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
export interface VisregConfig {
  id?: string;
  viewports: Viewport[];
  scenarios: Scenario[];
  scenarioDefaults?: Partial<Scenario>;
  paths?: VisregPaths;

  readyEvent?: string;
  readyTimeout?: number;

  engine?: 'playwright' | null;
  engineOptions?: EngineOptions;

  report?: string[];
  scenarioLogsInReports?: boolean;

  asyncCaptureLimit?: number;
  asyncCompareLimit?: number;

  defaultMisMatchThreshold?: number;
  resembleOutputOptions?: ResembleOutputOptions;

  compareRetries?: number;
  compareRetryDelay?: number;
  maxNumDiffPixels?: number;

  fileNameTemplate?: string;
  outputFormat?: string;

  debug?: boolean;
  debugWindow?: boolean;

  dynamicTestId?: string;

  ci?: {
    format?: string;
    testReportFileName?: string;
    testSuiteName?: string;
  };

  // compare
  comparePixelmatchThreshold?: number;
}

// ── Runtime Config (internal, after makeConfig + extendConfig) ───────
export interface RuntimeConfig {
  args: Record<string, unknown>;
  visregRoot: string;
  projectPath: string;
  perf: Record<string, number>;

  configFileName: string;
  /** `paths.artifacts` — the dir this invocation writes everything into. */
  unitArtifactsDir: string;
  /** `<unitArtifactsDir>/control_screenshots`. */
  controlScreenshotDir: string;
  /** `<unitArtifactsDir>/experiment_screenshots`. */
  experimentScreenshotDir: string;
  tempCompareConfigFileName: string;

  ciReport: CIReport;

  id?: string;
  engine: string | null;
  defaultMisMatchThreshold: number;
  defaultRequireSameDimensions?: boolean;
  debug: boolean;
  resembleOutputOptions?: ResembleOutputOptions;
  asyncCompareLimit?: number;
  visregVersion: string;
  scenarioLogsInReports?: boolean;
  testReportFileName?: string;
  viewports: Viewport[];

  compareRetries: number;
  compareRetryDelay: number;
  maxNumDiffPixels: number;

  isControl?: boolean;
}

// ── Decorated Compare Config (internal, used during compare) ─────
export interface DecoratedCompareConfig extends VisregConfig {
  _experimentScreenshotPath: string;
  _controlScreenshotPath: string;
  _fileNameTemplate: string;
  _outputFileFormatSuffix: string;
  _configId: string;
  env: RuntimeConfig;
  isControl: boolean;
  isCompare: boolean;
  defaultMisMatchThreshold: number;
  configFileName: string;
  defaultRequireSameDimensions?: boolean;
  compareRetries: number;
  compareRetryDelay: number;
  maxNumDiffPixels: number;
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
  referenceLog?: string;
  test: string;
  testLog?: string;
  selector: string;
  fileName: string;
  label: string;
  requireSameDimensions: boolean;
  misMatchThreshold: number;
  url: string;
  referenceUrl?: string;
  expect: number;
  viewportLabel: string;
  diff?: DiffResult;
  refWhitePixelPercent?: number;
  testWhitePixelPercent?: number;
  refIsBottomSeventyPercentWhite?: boolean;
  testIsBottomSeventyPercentWhite?: boolean;
  diffImage?: string;
  pixelmatchDiffImage?: string;
  error?: string;
  engineErrorMsg?: string;
  errorScreenshot?: string;
  annotationErrorMsg?: string;
  hadEngineError?: boolean;
  /**
   * True when this comparison initially mismatched but a later retry matched —
   * i.e. the test was visually flaky yet recovered. Surfaced in the report as
   * the "Flaky (saved by retries)" chip.
   */
  savedByRetries?: boolean;
  status?: string;
  scenario?: Scenario;
  viewport?: Viewport;
  msg?: string;
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
  hasLogged: (str: string) => boolean;
  startConsoleLogger: () => void;
  _consoleLogger?: string;
}

// ── Engine Input Config ─────────────────────────────────────────────
// What the compare runner's engine-bridge writes into a temp `.js`
// file for the visreg engine to pick up. Structurally the `visreg`
// slice of the unified `abtests.config.ts` (from `shaka-perf/compare`)
// plus a small set of visreg-engine-specific fields the engine still
// reads (paths, ci, debug flags, …). This is an internal plumbing
// type — not a user-authored config.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { VisregConfig as _VisregConfigSlice } from '../../config';

export type VisregEngineInputConfig = Partial<_VisregConfigSlice> & {
  id?: string;
  paths?: VisregPaths;

  readyEvent?: string;
  readyTimeout?: number;

  engine?: 'playwright' | null;

  report?: string[];
  scenarioLogsInReports?: boolean;

  fileNameTemplate?: string;
  outputFormat?: string;

  debug?: boolean;
  debugWindow?: boolean;

  dynamicTestId?: string;

  ci?: {
    format?: string;
    testReportFileName?: string;
    testSuiteName?: string;
  };
};
