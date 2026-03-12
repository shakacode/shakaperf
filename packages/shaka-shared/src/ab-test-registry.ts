import type { Page } from 'playwright-core';

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

  // Scripts (onBeforeScript only — onReadyScript replaced by testFn)
  onBeforeScript?: string;

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
  options: AbTestOptions;
  testFn: (context: { page: Page }) => Promise<void>;
}

const registry: AbTestDefinition[] = [];

export function abTest(
  name: string,
  config: {
    startingPath: string;
    options?: AbTestOptions;
  },
  testFn: (context: { page: Page }) => Promise<void>
): void {
  registry.push({
    name,
    startingPath: config.startingPath,
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
