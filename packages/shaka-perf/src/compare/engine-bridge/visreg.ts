import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import visregRunner from '../../visreg/core/runner';
import type { VisregConfig } from '../config';

export interface VisregBridgeOptions {
  controlURL: string;
  experimentURL: string;
  htmlReportDir: string;
  visregConfig: VisregConfig;
  testFile?: string;
  testPathPattern?: string;
  filter?: string;
}

/**
 * Invokes the visreg engine (same entry that powers `visreg-compare`) with
 * a temp config file synthesised from the unified abtests.config.ts `visreg`
 * slice, forcing `paths.htmlReport` so screenshots, report.json, etc. land
 * under the caller-specified directory.
 *
 * Visreg throws when any pair fails its threshold. We swallow that because
 * the caller still wants to harvest the report.json that was already written.
 */
export async function invokeVisregEngine(opts: VisregBridgeOptions): Promise<{ failed: boolean }> {
  const { controlURL, experimentURL, htmlReportDir, visregConfig, testFile, testPathPattern, filter } = opts;

  const configPath = writeTempVisregConfig(visregConfig, htmlReportDir);

  try {
    await visregRunner('compare', {
      config: configPath,
      controlURL,
      experimentURL,
      testFile,
      testPathPattern,
      filter,
    });
    return { failed: false };
  } catch (err) {
    if ((err as Error).message === 'Mismatch errors found.') {
      return { failed: true };
    }
    throw err;
  } finally {
    fs.rmSync(configPath, { force: true });
  }
}

function writeTempVisregConfig(visregConfig: VisregConfig, htmlReportDir: string): string {
  const payload = {
    ...visregConfig,
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
