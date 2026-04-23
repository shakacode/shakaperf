import type { AbTestDefinition } from 'shaka-shared';
import { runAxe, type AxeGlobalConfig, type RunAxeResult } from 'shaka-accessibility';

export interface AxeBridgeOptions {
  experimentURL: string;
  resultsFolder: string;
  axeConfig: AxeGlobalConfig;
  tests: AbTestDefinition[];
  log?: (message: string) => void;
}

/**
 * Runs the shaka-accessibility engine in-process for the given test list.
 * Unlike the visreg/perf bridges we don't have to synthesise a temp config or
 * spawn a worker — axe is already a plain Node library, so we just hand it the
 * resolved global config plus the test list compare already loaded.
 *
 * Writes per-test `<resultsFolder>/<slug>/axe-report.json` artifacts matching
 * AXE_A11Y_REQUIREMENTS.md §3.7, which the harvester (harvest/axe.ts) then
 * reads back into `CategoryResult.axe`.
 */
export async function invokeAxeEngine(opts: AxeBridgeOptions): Promise<RunAxeResult> {
  const { experimentURL, resultsFolder, axeConfig, tests, log } = opts;
  return runAxe({
    tests,
    globalConfig: axeConfig,
    experimentURL,
    resultsRoot: resultsFolder,
    log,
  });
}
