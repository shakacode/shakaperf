import type { Page, BrowserContext } from 'playwright-core';

export interface Marker {
  start?: string;
  end: string;
  label: string;
}

export interface Viewport {
  label: string;
  name?: string;
  width: number;
  height: number;
}

export enum TestType {
  VisualRegression = 'visual_regression',
  Performance = 'performance',
}

export interface TestFnContext {
  page: Page;
  browserContext: BrowserContext;
  isReference: boolean;
  scenario: AbTestDefinition;
  viewport: Viewport;
  testType: TestType;
  annotate: (label: string) => void;
}

export interface AbTestVisregConfig {
  // Selectors to capture (from Scenario)
  selectors?: string[];
  selectorExpansion?: boolean | string;
  hideSelectors?: string[];
  removeSelectors?: string[];

  // Interactions (from Scenario)
  hoverSelector?: string;
  hoverSelectors?: string[];
  clickSelector?: string;
  clickSelectors?: string[];
  scrollToSelector?: string;
  postInteractionWait?: number | string;

  // Comparison thresholds (from Scenario)
  misMatchThreshold?: number;
  requireSameDimensions?: boolean;
  maxNumDiffPixels?: number;
  compareRetries?: number;
  compareRetryDelay?: number;
  comparePixelmatchThreshold?: number;
  useBoundingBoxViewportForSelectors?: boolean;

  // Ready state (from Scenario)
  readyEvent?: string;
  readySelector?: string;
  readyTimeout?: number;
  delay?: number;

  // Cookies
  cookiePath?: string;

  // Lifecycle hook — runs before page navigation
  onBefore?: (context: TestFnContext) => Promise<void>;

  // Viewport override
  viewports?: Viewport[];
}

/**
 * Per-test accessibility tuning. Defined structurally here (not imported from
 * `shaka-accessibility`) to keep `shaka-shared` dependency-free — the axe
 * package re-uses these same shapes via its own Zod schema.
 */
export interface AbTestAxeConfig {
  viewports?: Viewport[];
  tags?: string[];
  disableRules?: string[];
  includeRules?: string[];
  /** Opt this test out of the axe run entirely. */
  skip?: boolean;
}

export interface AbTestOptions {
  markers?: Marker[];
  lhConfigPath?: string;
  resultsFolder?: string;
  visreg?: AbTestVisregConfig;
  axe?: AbTestAxeConfig;
}

export interface AbTestDefinition {
  name: string;
  startingPath: string;
  file: string | null;
  line: number | null;
  options: AbTestOptions;
  testFn: (context: TestFnContext) => Promise<void>;
}

const registry: AbTestDefinition[] = [];

export function abTest(
  name: string,
  config: {
    startingPath: string;
    options?: AbTestOptions;
  },
  testFn: (context: TestFnContext) => Promise<void>
): void {
    // Capture call-site file and line number from the stack trace
    let file: string | null = null;
    let line: number | null = null;
    const stack = new Error().stack;
    if (stack) {
      // Stack frame format: "at abTest (...)" then "at <call-site> (file:line:col)"
      const frames = stack.split('\n');
      // The caller is typically the 3rd frame (0=Error, 1=abTest, 2=caller)
      for (let i = 2; i < frames.length; i++) {
        const match = frames[i].match(/\(?([^()]+):(\d+):\d+\)?$/);
        if (match) {
          file = match[1].replace(/^\s*at\s+/, '');
          line = parseInt(match[2], 10);
          break;
        }
      }
    }

  registry.push({
    name,
    startingPath: config.startingPath,
    file,
    line,
    options: config.options ?? {},
    testFn,
  });
}

export function getRegisteredTests(): AbTestDefinition[] {
  return [...registry];
}

export function clearRegistry(): void {
  registry.length = 0;
}

export function restoreRegistry(previous: AbTestDefinition[]): void {
  registry.length = 0;
  for (const t of previous) registry.push(t);
}
