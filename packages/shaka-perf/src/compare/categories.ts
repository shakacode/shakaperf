import type { TestType } from 'shaka-shared';
import { perfCategoryDef } from './harvest/perf';
import { visregCategoryDef } from './harvest/visreg';
import type { CategoryDef } from './category-def';

/** Registry of per-test-type strategies. Adding a new engine = importing
 *  its `CategoryDef` and adding a key here; the orchestrator loop in
 *  run.ts walks this map without any per-testType branching.
 *  Partial because `accessibility` is in the `TestType` union but has
 *  no harvester yet. */
export const CATEGORY_DEFS: Partial<Record<TestType, CategoryDef>> = {
  visreg: visregCategoryDef,
  perf: perfCategoryDef,
};
