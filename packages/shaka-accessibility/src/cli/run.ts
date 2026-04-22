import * as path from 'node:path';
import {
  DEFAULT_EXPERIMENT_URL,
  findAbTestsConfig,
  loadAbTestsConfig,
  loadTests,
} from 'shaka-shared';
import { parseAxeGlobalConfig, type AxeGlobalConfig } from '../config';
import { runAxe, type RunAxeResult } from '../runner';

export interface RunAxeCommandOptions {
  cwd?: string;
  configPath?: string;
  experimentURL?: string;
  testPathPattern?: string;
  filter?: string;
  /**
   * Overrides the `resultsFolder` resolved from `abtests.config.ts`. The CLI
   * keeps this undocumented for now; primarily useful for tests.
   */
  resultsFolder?: string;
  log?: (message: string) => void;
}

export interface RunAxeCommandResult {
  resultsRoot: string;
  runResult: RunAxeResult;
  /** True when the run should gate CI (violations + failOnViolation, or errors). */
  hasFailures: boolean;
  failureSummary: string;
}

interface LoadedAxeConfig {
  axe: AxeGlobalConfig;
  experimentURL: string;
  resultsFolder: string;
  testPathPattern?: string;
  filter?: string;
}

async function loadAxeConfig(opts: RunAxeCommandOptions): Promise<LoadedAxeConfig> {
  const configPath = opts.configPath ?? findAbTestsConfig(opts.cwd);
  let raw: Record<string, unknown> = {};
  if (configPath) {
    raw = await loadAbTestsConfig(configPath);
  }
  const shared = (raw.shared ?? {}) as {
    experimentURL?: string;
    resultsFolder?: string;
    testPathPattern?: string;
    filter?: string;
  };
  const axe = parseAxeGlobalConfig(raw.axe ?? {});
  return {
    axe,
    experimentURL: shared.experimentURL ?? DEFAULT_EXPERIMENT_URL,
    resultsFolder: shared.resultsFolder ?? 'compare-results',
    testPathPattern: shared.testPathPattern,
    filter: shared.filter,
  };
}

function summarize(result: RunAxeResult, failOnViolation: boolean): {
  hasFailures: boolean;
  failureSummary: string;
} {
  const parts: string[] = [];
  if (result.fatalLaunchError) {
    parts.push(`axe engine failed to launch: ${result.fatalLaunchError}`);
  }
  if (result.errorCount > 0) {
    parts.push(`${result.errorCount} test error${result.errorCount === 1 ? '' : 's'}`);
  }
  if (failOnViolation && result.totalViolations > 0) {
    parts.push(`${result.totalViolations} a11y violation${result.totalViolations === 1 ? '' : 's'}`);
  }
  return {
    hasFailures: parts.length > 0,
    failureSummary: parts.join(', '),
  };
}

/**
 * Standalone V1 axe run. Loads tests via shaka-shared's loader (same
 * discovery/filter rules as compare/perf), resolves global + per-test axe
 * config, then hands off to `runAxe`.
 */
export async function runAxeCommand(opts: RunAxeCommandOptions = {}): Promise<RunAxeCommandResult> {
  const cwd = opts.cwd ?? process.cwd();
  const log = opts.log ?? ((m) => console.log(m));
  const loaded = await loadAxeConfig(opts);

  const experimentURL = opts.experimentURL ?? loaded.experimentURL;
  const resultsRoot = path.resolve(cwd, opts.resultsFolder ?? loaded.resultsFolder);

  const tests = await loadTests({
    testPathPattern: opts.testPathPattern ?? loaded.testPathPattern,
    filter: opts.filter ?? loaded.filter,
    log,
  });

  log(`\n>>> axe (${tests.length} test${tests.length === 1 ? '' : 's'} against ${experimentURL})`);
  const runResult = await runAxe({
    tests,
    globalConfig: loaded.axe,
    experimentURL,
    resultsRoot,
    log,
  });

  const { hasFailures, failureSummary } = summarize(runResult, loaded.axe.failOnViolation);
  return { resultsRoot, runResult, hasFailures, failureSummary };
}
