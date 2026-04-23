import type { Page as PlaywrightPage, BrowserContext, Browser } from 'playwright';
import { PHONE_VIEWPORT, TABLET_VIEWPORT, DESKTOP_VIEWPORT, type Viewport as SharedViewport } from 'shaka-shared';

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

  // Cookies
  cookiePath?: string;

  // Lifecycle hook — runs before page navigation
  onBefore?: (context: import('shaka-shared').TestFnContext) => Promise<void>;

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
  useBoundingBoxViewportForSelectors?: boolean;

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
  storageState?: string | Record<string, unknown>;
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
  htmlReport?: string;
  ciReport?: string;
  jsonReport?: string;
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

  useBoundingBoxViewportForSelectors?: boolean;

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
  controlScreenshotDir: string;
  experimentScreenshotDir: string;
  ciReportDir: string;
  htmlReportDir: string;
  jsonReportDir: string;
  compareJsonFileName: string;
  tempCompareConfigFileName: string;

  captureConfigFileName: string;
  captureConfigFileNameDefault: string;

  ciReport: CIReport;

  id?: string;
  engine: string | null;
  report: string[];
  defaultMisMatchThreshold: number;
  defaultRequireSameDimensions?: boolean;
  debug: boolean;
  resembleOutputOptions?: ResembleOutputOptions;
  asyncCompareLimit?: number;
  visregVersion: string;
  scenarioLogsInReports?: boolean;
  testReportFileName?: string;

  compareRetries: number;
  compareRetryDelay: number;
  maxNumDiffPixels: number;

  _runBaseDir: string;
  isReference?: boolean;
}

// ── Decorated Compare Config (internal, used during compare) ─────
export interface DecoratedCompareConfig extends VisregConfig {
  _experimentScreenshotPath: string;
  _controlScreenshotPath: string;
  _fileNameTemplate: string;
  _outputFileFormatSuffix: string;
  _configId: string;
  env: RuntimeConfig;
  isReference: boolean;
  isCompare: boolean;
  paths: VisregPaths;
  defaultMisMatchThreshold: number;
  configFileName: string;
  defaultRequireSameDimensions?: boolean;
  compareRetries: number;
  compareRetryDelay: number;
  maxNumDiffPixels: number;
  useBoundingBoxViewportForSelectors?: boolean;
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

// ── Cookie ──────────────────────────────────────────────────────────
export interface VisregCookie {
  name: string;
  value: string;
  domain?: string;
  url?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
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

// ── Global Visreg Config (visreg.config.ts — no scenarios) ──────────
// Aliased onto the zod-derived `VisregConfig` from
// `shaka-perf/compare` (the `visreg` slice of `abtests.config.ts`),
// widened with visreg-engine-specific fields the engine code still
// reads (paths, ci, report, debug flags, …). Kept as a public API for
// the `shaka-perf/visreg` subpath.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { VisregConfig as _VisregConfigSlice } from '../../compare/config';

export type VisregGlobalConfig = Partial<_VisregConfigSlice> & {
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

  useBoundingBoxViewportForSelectors?: boolean;
};

export function defineVisregConfig(config: VisregGlobalConfig): VisregGlobalConfig {
  return config;
}

export const VISREG_DEFAULT_CONFIG: VisregGlobalConfig = {
  // Canonical viewport singletons live in shaka-shared so visreg and perf
  // reference the exact same device dimensions — a desktop visreg capture
  // and a desktop perf run measure 1280×800, not two close-but-different
  // sizes that would muddle A/B comparisons.
  viewports: [PHONE_VIEWPORT, TABLET_VIEWPORT, DESKTOP_VIEWPORT],
  paths: {
    htmlReport: 'visreg_data/html_report',
    ciReport: 'visreg_data/ci_report',
  },
  report: ['browser', 'CI'],
  engineOptions: {
    browser: 'chromium',
    args: ['--no-sandbox'],
  },
  asyncCaptureLimit: 5,
  compareRetries: 5,
  compareRetryDelay: 1000,
  maxNumDiffPixels: 50,
  defaultMisMatchThreshold: 0.1,
};
