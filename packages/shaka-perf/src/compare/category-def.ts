import type { AbTestDefinition, TestType } from 'shaka-shared';
import type { AbTestsConfig, Viewport } from './config';
import type { CategoryResult } from './report';

export interface HarvestContext {
  test: AbTestDefinition;
  slug: string;
  /** Resolved viewport list for this test type × test (empty viewport-narrows
   *  are filtered out before harvest is called). */
  viewports: Viewport[];
  resultsRoot: string;
  controlURL: string;
  experimentURL: string;
  config: AbTestsConfig;
  /** Viewports whose perf engine pass threw before measurement could begin —
   *  the perf def consults this to distinguish "no report.json because
   *  shard didn't run this test" from "no report.json because engine
   *  crashed". Visreg ignores it. */
  perfEngineFailedByLabel: Set<string>;
}

/**
 * Per-test-type strategy. The orchestrator (`buildTestResult`) walks
 * `CATEGORY_DEFS` instead of branching on testType — adding a new engine
 * means defining a `CategoryDef` and registering it here, with no changes
 * to the orchestrator skeleton.
 *
 * `harvest` returns the result when at least one viewport produced
 * artifacts on disk, or null when none did (the orchestrator folds null
 * into `missingArtifactsCategory(testType)` so the "no artifacts"
 * message text is in one place across engines).
 *
 * Skipped paths (testTypes opt-out, empty viewport intersection) are
 * handled by the orchestrator and don't reach `harvest`.
 */
export interface CategoryDef {
  testType: TestType;
  viewports(config: AbTestsConfig): Viewport[];
  harvest(ctx: HarvestContext): CategoryResult | null;
}
