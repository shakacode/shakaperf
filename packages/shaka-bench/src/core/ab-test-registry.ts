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
  line: number | null;
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
