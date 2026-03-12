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
  _testFn?: (context: { page: PlaywrightPage }) => Promise<void>;
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
  bitmaps_reference?: string;
  bitmaps_test?: string;
  engine_scripts?: string;
  html_report?: string;
  ci_report?: string;
  json_report?: string;
  reports_archive?: string;
  tempCompareConfigFileName?: string;
}

// ── User Config (visreg.json) ─────────────────────────────────────
export interface VisregConfig {
  id?: string;
  viewports: Viewport[];
  scenarios: Scenario[];
  scenarioDefaults?: Partial<Scenario>;
  paths?: VisregPaths;

  onBeforeScript?: string;
  onReadyScript?: string;
  readyEvent?: string;
  readyTimeout?: number;

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
  visregRoot: string;
  projectPath: string;
  perf: Record<string, number>;

  configFileName: string;
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
  visregVersion: string;
  scenarioLogsInReports?: boolean;
  testReportFileName?: string;

  compareRetries: number;
  compareRetryDelay: number;
  maxNumDiffPixels: number;

  _runBaseDir: string;
  isReference?: boolean;
}

// ── Decorated Compare Config (internal, used during liveCompare) ─────
export interface DecoratedCompareConfig extends VisregConfig {
  _bitmapsTestPath: string;
  _bitmapsReferencePath: string;
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

// ── Playwright Script Function ──────────────────────────────────────
export type PlaywrightScriptFn = (
  page: PlaywrightPage,
  scenario: Scenario,
  viewport: Viewport,
  isReference: boolean,
  browserContext: BrowserContext,
  config?: RuntimeConfig
) => Promise<void>;

// ── Global Visreg Config (visreg.config.ts — no scenarios) ──────────
export interface VisregGlobalConfig {
  id?: string;
  viewports: Viewport[];
  paths?: VisregPaths;

  onBeforeScript?: string;
  readyEvent?: string;
  readyTimeout?: number;

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

  ci?: {
    format?: string;
    testReportFileName?: string;
    testSuiteName?: string;
  };

  useBoundingBoxViewportForSelectors?: boolean;

  liveComparePixelmatchThreshold?: number;
}

export function defineVisregConfig(config: VisregGlobalConfig): VisregGlobalConfig {
  return config;
}
