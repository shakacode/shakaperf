import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import visregRunner from '../../visreg/core/runner';
import type { SharedConfig, VisregConfig } from '../config';

export interface VisregBridgeOptions {
  controlURL: string;
  experimentURL: string;
  htmlReportDir: string;
  visregConfig: VisregConfig;
  /**
   * Cross-engine knobs (parallelism, retries, retryDelay) that visreg lowers
   * into its legacy runtime-config field names (`asyncCaptureLimit`,
   * `asyncCompareLimit`, `compareRetries`, `compareRetryDelay`). Sourced by
   * the caller from `abtests.config.ts` `shared.*`.
   */
  sharedConfig: SharedConfig;
  testPathPattern?: string;
  filter?: string;
}

/**
 * Invokes the visreg engine (same entry that powers `visreg-compare`) with
 * a temp config file synthesised from the unified abtests.config.ts `visreg`
 * slice, forcing `paths.htmlReport` so screenshots, report.json, etc. land
 * under the caller-specified directory.
 *
 * Returns without throwing when the engine completes with threshold mismatches
 * — the caller harvests the per-pair status from report.json. Real engine
 * crashes (browser driver, CDP, missing config) still throw.
 */
export async function invokeVisregEngine(opts: VisregBridgeOptions): Promise<void> {
  const { controlURL, experimentURL, htmlReportDir, visregConfig, sharedConfig, testPathPattern, filter } = opts;

  const configPath = writeTempVisregConfig(visregConfig, sharedConfig, htmlReportDir);

  try {
    await visregRunner('compare', {
      config: configPath,
      controlURL,
      experimentURL,
      testPathPattern,
      filter,
    });
  } finally {
    // Swallow cleanup errors so a failing tmp-file unlink (EPERM/EBUSY on
    // locked filesystems) can't shadow a primary engine error.
    try { fs.rmSync(configPath, { force: true }); } catch { /* noop */ }
  }
}

function writeTempVisregConfig(
  visregConfig: VisregConfig,
  sharedConfig: SharedConfig,
  htmlReportDir: string,
): string {
  const payload = {
    ...visregConfig,
    // Lower the cross-engine `shared.parallelism` + retry policy into the
    // legacy visreg runtime-config field names. `asyncCaptureLimit` bounds
    // concurrent browser captures; `asyncCompareLimit` bounds concurrent
    // pixel comparisons. Both map cleanly onto a single "cpu budget" knob.
    asyncCaptureLimit: sharedConfig.parallelism,
    asyncCompareLimit: sharedConfig.parallelism,
    compareRetries: sharedConfig.retries,
    compareRetryDelay: sharedConfig.retryDelay,
    paths: {
      htmlReport: htmlReportDir,
    },
    report: ['browser'],
  };
  const hash = crypto.randomBytes(6).toString('hex');
  const tempPath = path.join(os.tmpdir(), `shaka-perf-visreg-${hash}.js`);
  const body = `module.exports = ${JSON.stringify(payload, null, 2)};\n`;
  fs.writeFileSync(tempPath, body);
  return tempPath;
}
