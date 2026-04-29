import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { runCompare as runBenchCompare, type ICompareFlags } from '../../bench/cli/commands/compare';
import { lhConfigForViewport } from '../../bench/core/lighthouse-config';
import { ensureLighthousePatchRegistered } from '../../bench/core/patched-lighthouse/register-patch';
import type { PerfConfig, SharedConfig, Viewport } from '../config';

export interface PerfBridgeOptions {
  controlURL: string;
  experimentURL: string;
  resultsFolder: string;
  perfConfig: PerfConfig;
  sharedConfig: SharedConfig;
  viewports: Viewport[];
  testPathPattern?: string;
  filter?: string;
  warmedUpByVisreg?: boolean;
}

export async function invokePerfEngine(opts: PerfBridgeOptions): Promise<void> {
  const {
    controlURL,
    experimentURL,
    resultsFolder,
    perfConfig,
    sharedConfig,
    viewports,
    testPathPattern,
    filter,
    warmedUpByVisreg,
  } = opts;

  // Announce the Lighthouse patch once per invocation in the main process;
  // forked workers inherit `SHAKA_PERF_PATCH_ANNOUNCED` and stay quiet.
  ensureLighthousePatchRegistered();

  const lhConfigPaths = await Promise.all(
    viewports.map(async (viewport) => ({
      viewport,
      config: await writeLighthouseConfigFile(perfConfig, viewport),
    }))
  );

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
    parallelism: sharedConfig.parallelism,
    samplingMode: perfConfig.samplingMode ?? 'simultaneous',
    skipPerfWarmup: perfConfig.skipPerfWarmup,
    warmedUpByVisreg,
    skipLowNoiseProfiles: perfConfig.skipLowNoiseProfiles,
    lowNoiseProfilesOnly: perfConfig.lowNoiseProfilesOnly,
    retries: sharedConfig.retries,
    retryDelay: sharedConfig.retryDelay,
    viewportConfigs: lhConfigPaths,
  };

  try {
    await runBenchCompare(flags);
  } finally {
    for (const { config: lhConfigPath } of lhConfigPaths) {
      fs.rmSync(lhConfigPath, { force: true });
    }
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
