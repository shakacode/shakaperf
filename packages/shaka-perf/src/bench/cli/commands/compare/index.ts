/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from "node:path";
import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";

import chalk from "chalk";
import {
  Benchmark,
  createLighthouseBenchmark,
  generateHtmlDiffs,
  generateTimelineComparison,
  generateTimelinePreviewSvg,
  LighthouseBenchmarkOptions,
  NavigationSample,
  run,
} from "../../../core";
import { loadTests, TestType, type Viewport } from "shaka-shared";
import {
  mkdirpSync,
  writeFileSync,
} from "fs-extra";

// Scratch files the bench worker writes during a run; both are folded into
// the per-test report.json at the end and then deleted so the on-disk layout
// matches visreg's (all per-test state inside one JSON). The composing +
// truncation helper lives in `compare/engine-error.ts` and is shared with
// the visreg bridge, so both engines produce the same payload shape.
const ENGINE_ERROR_FILE = "engine-error.txt";
const ENGINE_LOG_FILE = "engine-output.log";

import type { RegressionThresholdStat, SamplingMode } from "../../command-config/tb-config";
import {
  chalkScheme,
  durationInSec,
  logHeading,
  secondsToTime,
  timestamp,
} from "../../helpers/utils";
import { composeEngineErrorPayload } from "../../../../compare/engine-error";
import { runAnalyze } from "./analyze";
import { runReport } from "./report";

export interface ICompareFlags {
  hideAnalysis: boolean;
  numberOfMeasurements: number;
  resultsFolder: string;
  controlURL: string | undefined;
  experimentURL: string | undefined;
  testPathPattern: string | undefined;
  filter: string | undefined;
  regressionThreshold?: number;
  sampleTimeoutMs: number;
  skipReport?: boolean;
  regressionThresholdStat: RegressionThresholdStat;
  pValueThreshold: number;
  parallelism: number;
  samplingMode: SamplingMode;
  /**
   * Number of additional attempts (beyond the first) the Lighthouse sampler
   * makes when a sample throws before giving up on that iteration. `retryDelay`
   * is the ms between attempts. Sourced from `shared.retries` / `shared.retryDelay`.
   */
  retries?: number;
  retryDelay?: number;
  duration?: number;
  config?: string;
  /** Viewport this pass measures — propagated into the sampler's TestFnContext. */
  viewport: Viewport;
}

const ARTIFACT_DESCRIPTIONS: Record<string, string> = {
  'ab-measurements.json': 'Raw measurement samples',
  'report.json': 'Statistical analysis + folded engine error/output (JSON)',
  'report.txt': 'Summary',
  'report.html': 'Interactive HTML report with charts',
  'artifact-1.html': 'Bench HTML report (boxplots + phase charts)',
  'timeline_comparison.html': 'Visual timeline (control vs experiment)',
};

function describeArtifact(filename: string): string {
  if (ARTIFACT_DESCRIPTIONS[filename]) return ARTIFACT_DESCRIPTIONS[filename];
  if (filename.endsWith('_lighthouse_report.html')) return 'Lighthouse report';
  if (filename.endsWith('_performance_profile.json')) return 'Performance profile (DevTools)';
  if (filename.endsWith('_performance_profile_summary.txt')) return 'Performance profile summary';
  if (filename.endsWith('_network_activity.txt')) return 'Network activity';
  if (filename.endsWith('.diff.html')) return 'Control vs experiment diff';
  return '';
}

function listArtifacts(dir: string, relativeBase: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relativePath = path.join(relativeBase, entry);
    const isDir = statSync(fullPath).isDirectory();
    if (!isDir) {
      const desc = describeArtifact(entry);
      const descStr = desc ? ` ${chalk.dim('—')} ${chalk.dim(desc)}` : '';
      console.log(`  ${chalk.cyan(relativePath)}${descStr}`);
    }
  }
}

interface TestInfo {
  name: string;
  testFile: string | null;
  line: number | null;
  resultsFolder: string;
}

function tryUnlink(p: string): void {
  try { unlinkSync(p); } catch { /* missing / locked — not worth surfacing */ }
}

/**
 * Fold engine-error.txt + engine-output.log into the per-test report.json
 * and delete the two scratch files.
 *
 * `overrideStack` is supplied on the failure path (the test's try/catch
 * hasn't written engine-error.txt yet and we don't want a transient file
 * just to read it back); on the success path it's null and the helper
 * still runs to absorb whatever the worker logged during measurement.
 *
 * Never throws — a bad report.json is replaced rather than left half-merged.
 */
function foldEngineArtifactsIntoReport(
  testResultsFolder: string,
  overrideStack: string | null,
): void {
  const errPath = path.join(testResultsFolder, ENGINE_ERROR_FILE);
  const logPath = path.join(testResultsFolder, ENGINE_LOG_FILE);
  const reportPath = path.join(testResultsFolder, 'report.json');

  let stack: string | null = overrideStack;
  if (!stack) {
    try {
      const raw = readFileSync(errPath, 'utf8').trim();
      if (raw) stack = raw;
    } catch { /* no error file */ }
  }

  let log: string | null = null;
  try {
    const raw = readFileSync(logPath, 'utf8').trim();
    if (raw) log = raw;
  } catch { /* no log file */ }

  const shortMessage = stack ? stack.split(/\r?\n/, 1)[0] || null : null;
  const transcript = stack || log
    ? [
        ...(stack ? ['── error ──', stack, ''] : []),
        ...(log ? ['── engine output ──', log] : []),
      ].join('\n')
    : null;
  const payload = composeEngineErrorPayload(shortMessage, transcript);

  if (!payload.engineError && !payload.engineOutput) {
    tryUnlink(errPath);
    tryUnlink(logPath);
    return;
  }

  let report: Record<string, unknown> = {};
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
  } catch { /* no prior report.json (failure before analyze) — start fresh */ }

  Object.assign(report, payload);

  try {
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(`Failed to fold engine artifacts into ${reportPath}:`, err);
    return;
  }

  tryUnlink(errPath);
  tryUnlink(logPath);
}

function formatTestTitle(testFile: string | null, name: string, line?: number | null): string {
  const loc = testFile ? (line ? `${testFile}:${line}` : testFile) : '(unknown source)';
  return chalk.dim(loc) + chalk.bold.yellow(` ${name}`);
}

export async function runCompare(compareFlags: ICompareFlags): Promise<string> {
  if (!compareFlags.controlURL) {
    console.error("controlURL is required as a cli flag");
    process.exit(2);
  }
  if (!compareFlags.experimentURL) {
    console.error("experimentURL is required as a cli flag");
    process.exit(2);
  }
  const tests = await loadTests({
    testPathPattern: compareFlags.testPathPattern,
    filter: compareFlags.filter,
    testType: TestType.Performance,
    log: (msg) => console.log(msg),
  });

  mkdirpSync(compareFlags.resultsFolder!);

  const resultsFolder = compareFlags.resultsFolder;
  const options: LighthouseBenchmarkOptions = {
    viewport: compareFlags.viewport,
    resultsFolder,
    lhConfigPath: compareFlags.config,
    retries: compareFlags.retries,
    retryDelay: compareFlags.retryDelay,
  };

  let analyzedJSONString = "";
  const completedTests: TestInfo[] = [];
  const failedTests: { name: string; reason: string }[] = [];

  for (const testDef of tests) {
    console.log(`\n${formatTestTitle(testDef.file ?? null, testDef.name, testDef.line)}`);

    const slug = testDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const testResultsFolder = `${resultsFolder}/${slug}`;
    mkdirpSync(testResultsFolder);

    const testOptions: LighthouseBenchmarkOptions = {
      ...options,
      resultsFolder: testResultsFolder,
      logFile: path.join(testResultsFolder, ENGINE_LOG_FILE),
    };

    try {
      const control: Benchmark<NavigationSample> = createLighthouseBenchmark(
        "control",
        compareFlags.controlURL!,
        testDef,
        testOptions
      );
      const experiment: Benchmark<NavigationSample> = createLighthouseBenchmark(
        "experiment",
        compareFlags.experimentURL!,
        testDef,
        testOptions
      );

      const sampleTimeoutMs = compareFlags.sampleTimeoutMs;

      const startTime = timestamp();
      const results = (
        await run(
          [control, experiment],
          compareFlags.numberOfMeasurements as number,
          (elapsed, completed, remaining, group, iteration) => {
            if (completed > 0) {
              const average = elapsed / completed;
              const remainingSecs = Math.round((remaining * average) / 1000);
              const remainingTime = secondsToTime(remainingSecs);
              console.log(
                "%s: %s %s remaining",
                group.padStart(15),
                iteration.toString().padStart(2),
                `${remainingTime}`.padStart(10)
              );
            } else {
              console.log(
                "%s: %s",
                group.padStart(15),
                iteration.toString().padStart(2)
              );
            }
          },
          {
            sampleTimeoutMs,
            parallelism: compareFlags.parallelism,
            samplingMode: compareFlags.samplingMode,
            durationMs: compareFlags.duration ? compareFlags.duration * 1000 : undefined,
          }
        )
      ).map(({ group, samples }) => {
        const meta = samples.length > 0 ? samples[0].metadata : {};
        return {
          group,
          set: group,
          samples,
          meta,
        };
      });
      const endTime = timestamp();
      if (!results[0].samples[0]) {
        throw new Error(
          `No measurements were collected.\nCONTROL: ${compareFlags.controlURL}\nEXPERIMENT: ${compareFlags.experimentURL}`
        );
      }
      const abMeasurementsPath = `${testResultsFolder}/ab-measurements.json`;
      generateHtmlDiffs({
        testResultsFolder,
        controlURL: compareFlags.controlURL!,
        experimentURL: compareFlags.experimentURL!,
      });

      // Generate timeline comparison from performance profiles
      {
        const files = readdirSync(testResultsFolder);
        const controlHost = new URL(compareFlags.controlURL!).host.replace(':', '_');
        const experimentHost = new URL(compareFlags.experimentURL!).host.replace(':', '_');
        const controlProfile = files.find(f => f.startsWith(controlHost) && f.endsWith('_performance_profile.json'));
        const experimentProfile = files.find(f => f.startsWith(experimentHost) && f.endsWith('_performance_profile.json'));
        if (controlProfile && experimentProfile) {
          generateTimelineComparison({
            controlProfilePath: path.join(testResultsFolder, controlProfile),
            experimentProfilePath: path.join(testResultsFolder, experimentProfile),
            outputPath: path.join(testResultsFolder, 'timeline_comparison.html'),
          });
          generateTimelinePreviewSvg({
            controlProfilePath: path.join(testResultsFolder, controlProfile),
            experimentProfilePath: path.join(testResultsFolder, experimentProfile),
            outputPath: path.join(testResultsFolder, 'timeline_preview.svg'),
          });
        }
      }

      writeFileSync(abMeasurementsPath, JSON.stringify(results));
      completedTests.push({ name: testDef.name, testFile: testDef.file ?? null, line: testDef.line, resultsFolder: testResultsFolder });

      const duration = secondsToTime(durationInSec(endTime, startTime));
      const actualMeasurements = results[0].samples.length;
      const message = `${chalkScheme.blackBgGreen(
        `    ${chalkScheme.white("SUCCESS")}    `
      )} ${actualMeasurements} measurements took ${duration}`;

      console.log(`\n${message}`);

      // if the stdout analysis is not hidden show it
      if (!compareFlags.hideAnalysis) {
        analyzedJSONString = await runAnalyze(abMeasurementsPath, {
          numberOfMeasurements: actualMeasurements,
          regressionThreshold: compareFlags.regressionThreshold!,
          regressionThresholdStat: compareFlags.regressionThresholdStat!,
          pValueThreshold: compareFlags.pValueThreshold,
          jsonReport: true,
        });
      }

      // Emit the legacy bench Handlebars+Chart.js HTML report alongside
      // ab-measurements.json so the unified compare report can link to it.
      if (!compareFlags.skipReport) {
        try {
          await runReport({
            resultsFolder: testResultsFolder,
            pValueThreshold: compareFlags.pValueThreshold,
          });
        } catch (err) {
          console.error(`Failed to generate bench HTML report for ${testDef.name}:`, err);
        }
      }

      // Absorb the run's engine-output.log transcript into report.json so
      // the on-disk layout is symmetric with visreg (one JSON holds all
      // per-test state — error, log, metrics).
      foldEngineArtifactsIntoReport(testResultsFolder, null);
    } catch (err) {
      // Per-test failure: fold the error stack + any partial engine log
      // directly into report.json. Previously we wrote engine-error.txt
      // here and let the harvester pick it up; now the harvester reads
      // from report.json only, so we skip the intermediate file.
      const error = err instanceof Error ? err : new Error(String(err));
      const reason = error.stack ?? error.message;
      foldEngineArtifactsIntoReport(testResultsFolder, reason);
      const failBanner = `${chalkScheme.blackBgRed(
        `    ${chalkScheme.white("FAILED")}     `
      )} ${error.message}`;
      console.log(`\n${failBanner}`);
      failedTests.push({ name: testDef.name, reason: error.message });
    }
  }

  // List all generated artifacts per test
  logHeading("Generated Artifacts", "log");
  for (const test of completedTests) {
    console.log(`\n${formatTestTitle(test.testFile, test.name, test.line)}`);
    listArtifacts(test.resultsFolder, test.resultsFolder);
  }
  if (failedTests.length > 0) {
    logHeading("Failed Tests", "alert");
    for (const failed of failedTests) {
      console.log(`  ${chalk.red(failed.name)} ${chalk.dim('—')} ${chalk.dim(failed.reason)}`);
    }
  }
  console.log('');

  return analyzedJSONString;
}
