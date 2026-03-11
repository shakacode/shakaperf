import type { Page } from 'playwright-core';
import type { Marker } from './lighthouse-config';

export interface AbTestOptions {
  markers?: Marker[];
  lhConfigPath?: string;
  resultsFolder?: string;
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
