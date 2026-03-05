import type { Page as PlaywrightPage, BrowserContext, Browser } from 'playwright';

export type { PlaywrightPage, BrowserContext, Browser };

// ── Viewport ────────────────────────────────────────────────────────
export interface Viewport {
  label: string;
  name?: string;
  width: number;
  height: number;
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

  // Scripts
  onBeforeScript?: string;
  onReadyScript?: string;

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

  // Engine options override
  engineOptions?: Partial<EngineOptions>;
  gotoParameters?: Record<string, any>;

  // Variants
  variants?: Variant[];

  // liveCompare overrides
  compareRetries?: number;
  compareRetryDelay?: number;
  maxNumDiffPixels?: number;
  liveComparePixelmatchThreshold?: number;

  // Internal (set at runtime)
  sIndex?: number;
  _parent?: Scenario;
  _playwrightBrowser?: Browser;
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
export interface BackstopPaths {
  bitmaps_reference?: string;
  bitmaps_test?: string;
  engine_scripts?: string;
  html_report?: string;
  ci_report?: string;
  json_report?: string;
  reports_archive?: string;
  tempCompareConfigFileName?: string;
}

// ── User Config (backstop.json) ─────────────────────────────────────
export interface BackstopConfig {
  id?: string;
  viewports: Viewport[];
  scenarios: Scenario[];
  scenarioDefaults?: Partial<Scenario>;
  paths?: BackstopPaths;

  onBeforeScript?: string;
  onReadyScript?: string;

  engine?: 'playwright' | null;
  engineOptions?: EngineOptions;

  report?: string[];
  openReport?: boolean;
  archiveReport?: boolean;
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
  dockerCommandTemplate?: string;

  ci?: {
    format?: string;
    testReportFileName?: string;
    testSuiteName?: string;
  };

  useBoundingBoxViewportForSelectors?: boolean;

  // liveCompare
  liveComparePixelmatchThreshold?: number;
}

// ── Runtime Config (internal, after makeConfig + extendConfig) ───────
export interface RuntimeConfig {
  args: Record<string, unknown>;
  backstop: string;
  projectPath: string;
  perf: Record<string, number>;

  backstopConfigFileName: string;
  bitmaps_reference: string;
  bitmaps_test: string;
  ci_report: string;
  html_report: string;
  json_report: string;
  engine_scripts: string;
  engine_scripts_default: string;

  compareConfigFileName: string;
  compareReportURL: string;
  compareJsonFileName: string;
  comparePath: string;
  tempCompareConfigFileName: string;

  captureConfigFileName: string;
  captureConfigFileNameDefault: string;
  archivePath: string;

  ciReport: CIReport;

  id?: string;
  engine: string | null;
  report: string[];
  openReport: boolean;
  archiveReport: boolean;
  defaultMisMatchThreshold: number;
  defaultRequireSameDimensions?: boolean;
  debug: boolean;
  resembleOutputOptions?: ResembleOutputOptions;
  asyncCompareLimit?: number;
  backstopVersion: string;
  dockerCommandTemplate?: string;
  scenarioLogsInReports?: boolean;
  testReportFileName?: string;

  compareRetries: number;
  compareRetryDelay: number;
  maxNumDiffPixels: number;

  screenshotDateTime?: string;
  isReference?: boolean;
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
  referenceLog: string;
  test: string;
  testLog: string;
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
  diffImage?: string;
  error?: string;
  engineErrorMsg?: string;
  status?: string;
  scenario?: Scenario;
  viewport?: Viewport;
  msg?: string;
}

// ── Compare Config ──────────────────────────────────────────────────
export interface CompareConfig {
  testPairs: TestPair[];
}

// ── Cookie ──────────────────────────────────────────────────────────
export interface BackstopCookie {
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

// ── Playwright Script Function ──────────────────────────────────────
export type PlaywrightScriptFn = (
  page: PlaywrightPage,
  scenario: Scenario,
  viewport: Viewport,
  isReference: boolean,
  browserContext: BrowserContext,
  config?: RuntimeConfig
) => Promise<void>;
