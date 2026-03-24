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
  liveComparePixelmatchThreshold?: number;

  // Ready state (from Scenario)
  readyEvent?: string;
  readySelector?: string;
  readyTimeout?: number;
  delay?: number;

  // Cookies
  cookiePath?: string;

  // Viewport override
  viewports?: Viewport[];
}

export interface AbTestOptions {
  markers?: Marker[];
  lhConfigPath?: string;
  resultsFolder?: string;
  visreg?: AbTestVisregConfig;
}

export interface AbTestDefinition {
  name: string;
  startingPath: string;
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
    // Capture call-site line number from the stack trace
    let line: number | null = null;
    const stack = new Error().stack;
    if (stack) {
      // Stack frame format: "at abTest (...)" then "at <call-site> (file:line:col)"
      const frames = stack.split('\n');
      // The caller is typically the 3rd frame (0=Error, 1=abTest, 2=caller)
      for (let i = 2; i < frames.length; i++) {
        const match = frames[i].match(/:(\d+):\d+\)?$/);
        if (match) {
          line = parseInt(match[1], 10);
          break;
        }
      }
    }

  registry.push({
    name,
    startingPath: config.startingPath,
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
