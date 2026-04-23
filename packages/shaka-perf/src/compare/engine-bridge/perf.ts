import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { runCompare as runBenchCompare, type ICompareFlags } from '../../bench/cli/commands/compare';
import { lhConfigForViewport } from '../../bench/core/lighthouse-config';
import { ensureLighthousePatchRegistered } from '../../bench/core/patched-lighthouse/register-patch';
import type { PerfConfig, SharedConfig, Viewport } from '../config';

const DEFAULT_PERF_PARALLELISM = Math.max(1, Math.floor(os.cpus().length / 2));

export interface PerfBridgeOptions {
  controlURL: string;
  experimentURL: string;
  resultsFolder: string;
  perfConfig: PerfConfig;
  sharedConfig: SharedConfig;
  /**
   * Viewport this pass measures. The bench worker receives a Lighthouse
   * config whose `formFactor` and `screenEmulation` are derived from this
   * viewport; user-provided `perf.lighthouseConfig` fills in everything
   * else (throttling, categories, etc.) but cannot override the
   * viewport-owned fields.
   */
  viewport: Viewport;
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
    viewport,
    testPathPattern,
    filter,
  } = opts;

  // Announce the Lighthouse patch once per invocation in the main process;
  // forked workers inherit `SHAKA_PERF_PATCH_ANNOUNCED` and stay quiet.
  ensureLighthousePatchRegistered();

  const lhConfigPath = await writeLighthouseConfigFile(perfConfig, viewport);

  const flags: ICompareFlags = {
    // hideAnalysis:false is required for the bench runner to invoke
    // runAnalyze, which writes the per-test report.json (ICompareJSONResults)
    // that our harvester consumes. skipReport:false asks bench to also
    // emit the legacy Handlebars `artifact-N.html` so the unified report
    // can link to it as a drill-down.
    hideAnalysis: false,
    skipReport: false,
    numberOfMeasurements: perfConfig.numberOfMeasurements ?? 20,
    resultsFolder,
    controlURL,
    experimentURL,
    testPathPattern,
    filter,
    regressionThreshold: perfConfig.regressionThreshold ?? 0,
    sampleTimeoutMs: perfConfig.sampleTimeoutMs ?? 120_000,
    regressionThresholdStat: perfConfig.regressionThresholdStat ?? 'estimator',
    pValueThreshold: perfConfig.pValueThreshold ?? 0.05,
    parallelism: perfConfig.parallelism ?? DEFAULT_PERF_PARALLELISM,
    samplingMode: perfConfig.samplingMode ?? 'simultaneous',
    config: lhConfigPath,
  };

  try {
    await runBenchCompare(flags);
  } finally {
    fs.rmSync(lhConfigPath, { force: true });
  }
}

async function writeLighthouseConfigFile(
  perfConfig: PerfConfig,
  viewport: Viewport,
): Promise<string> {
  const merged = lhConfigForViewport(viewport, perfConfig.lighthouseConfig);
  const hash = crypto.randomBytes(6).toString('hex');
  const tempPath = path.join(os.tmpdir(), `shaka-perf-lh-${hash}.js`);
  const body = `module.exports = ${JSON.stringify(merged, null, 2)};\n`;
  fs.writeFileSync(tempPath, body);
  return tempPath;
}
