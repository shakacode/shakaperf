import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { runCompare as runBenchCompare, type ICompareFlags } from '../../bench/cli/commands/compare';
import type { PerfConfig, SharedConfig } from '../config';

const DEFAULT_PERF_PARALLELISM = Math.max(1, Math.floor(os.cpus().length / 2));

export interface PerfBridgeOptions {
  controlURL: string;
  experimentURL: string;
  resultsFolder: string;
  perfConfig: PerfConfig;
  sharedConfig: SharedConfig;
  testFile?: string;
  testPathPattern?: string;
  filter?: string;
}

/**
 * Invokes the bench runCompare (same entry that powers `perf-compare`) with
 * flags derived from the unified abtests.config.ts `perf` slice. Bench writes
 * per-test artifacts (ab-measurements.json, report.json, lighthouse HTMLs,
 * timeline_comparison.html, *.diff.html) into <resultsFolder>/<slug>/.
 */
export async function invokePerfEngine(opts: PerfBridgeOptions): Promise<void> {
  const {
    controlURL,
    experimentURL,
    resultsFolder,
    perfConfig,
    testFile,
    testPathPattern,
    filter,
  } = opts;

  const lhConfigPath = await resolveLighthouseConfigPath(perfConfig);

  const flags: ICompareFlags = {
    // hideAnalysis:false is required for the bench runner to invoke
    // runAnalyze, which writes the per-test report.json (ICompareJSONResults)
    // that our harvester consumes. skipReport:true still suppresses the
    // legacy Handlebars artifact-N.html, which is superseded by the unified
    // compare report.
    hideAnalysis: false,
    skipReport: true,
    numberOfMeasurements: perfConfig.numberOfMeasurements ?? 20,
    resultsFolder,
    controlURL,
    experimentURL,
    testFile,
    testPathPattern,
    filter,
    regressionThreshold: perfConfig.regressionThreshold ?? 0,
    sampleTimeout: perfConfig.sampleTimeout ?? 120,
    regressionThresholdStat: perfConfig.regressionThresholdStat ?? 'estimator',
    pValueThreshold: perfConfig.pValueThreshold ?? 0.05,
    parallelism: perfConfig.parallelism ?? DEFAULT_PERF_PARALLELISM,
    samplingMode: perfConfig.samplingMode ?? 'simultaneous',
    config: lhConfigPath ?? undefined,
  };

  try {
    await runBenchCompare(flags);
  } finally {
    if (lhConfigPath && lhConfigPath.startsWith(os.tmpdir())) {
      fs.rmSync(lhConfigPath, { force: true });
    }
  }
}

async function resolveLighthouseConfigPath(perfConfig: PerfConfig): Promise<string | null> {
  if (perfConfig.lhConfigPath) {
    return path.resolve(perfConfig.lhConfigPath);
  }
  if (!perfConfig.lighthouseConfig) {
    return null;
  }
  const hash = crypto.randomBytes(6).toString('hex');
  const tempPath = path.join(os.tmpdir(), `shaka-perf-lh-${hash}.js`);
  const body = `module.exports = ${JSON.stringify(perfConfig.lighthouseConfig, null, 2)};\n`;
  fs.writeFileSync(tempPath, body);
  return tempPath;
}
