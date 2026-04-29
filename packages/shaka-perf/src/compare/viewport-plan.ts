import type { AbTestDefinition } from 'shaka-shared';
import type { Viewport } from './config';

export interface TestViewportPlan {
  test: AbTestDefinition;
  viewports: Viewport[];
}

export function resolveViewportsForTest(
  test: AbTestDefinition,
  categoryViewports: Viewport[],
): Viewport[] {
  const narrow = test.options.viewports;
  if (!narrow || narrow.length === 0) return categoryViewports;
  const narrowSet = new Set(narrow);
  return categoryViewports.filter((v) => narrowSet.has(v.label));
}

export function planTestViewports(
  tests: AbTestDefinition[],
  categoryViewports: Viewport[],
): TestViewportPlan[] {
  return tests.map((test) => ({
    test,
    viewports: resolveViewportsForTest(test, categoryViewports),
  }));
}
