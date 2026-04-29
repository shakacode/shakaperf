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
  LighthouseSamplingWorkerPool,
  LighthouseBenchmarkOptions,
  measureTest,
  NavigationSample,
  warmUpTest,
} from "../../../core";
import { loadTests, type AbTestDefinition, type Viewport } from "shaka-shared";
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
import {
  formatLogPrefix,
  testSourcePrefix,
} from "../../../../visreg/core/util/testContext";
import { planTestViewports } from "../../../../compare/viewport-plan";
import { announceStage } from "../../../../compare/announce-stage";

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
   * Number of additional pair attempts (beyond the first) the shared sampling
   * pool makes when a measurement throws. `retryDelay` is the ms between pair
   * attempts. Sourced from `shared.retries` / `shared.retryDelay`.
   */
  retries?: number;
  retryDelay?: number;
  duration?: number;
  config?: string;
  viewportConfigs?: { viewport: Viewport; config?: string }[];
  skipPerfWarmup?: boolean;
  warmedUpByVisreg?: boolean;
  skipLowNoiseProfiles?: boolean;
  lowNoiseProfilesOnly?: boolean;
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

interface TestContext {
  name: string;
  testFile: string | null;
  line: number | null;
  slug: string;
  viewport: Viewport;
  resultsFolder: string;
  benchmarks: [Benchmark<NavigationSample>, Benchmark<NavigationSample>];
}

interface PhaseProgress {
  stageName: string;
  skipOption: string;
  start: number;
  completed: number;
  totalSamples: number | null;
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

function createBenchmarks(
  testDef: AbTestDefinition,
  compareFlags: ICompareFlags,
  testOptions: LighthouseBenchmarkOptions,
): [Benchmark<NavigationSample>, Benchmark<NavigationSample>] {
  return [
    createLighthouseBenchmark(
      "control",
      compareFlags.controlURL!,
      testDef,
      testOptions
    ),
    createLighthouseBenchmark(
      "experiment",
      compareFlags.experimentURL!,
      testDef,
      testOptions
    ),
  ];
}

function writeTimelineArtifacts(
  testResultsFolder: string,
  controlURL: string,
  experimentURL: string,
): void {
  const files = readdirSync(testResultsFolder);
  const controlHost = new URL(controlURL).host.replace(':', '_');
  const experimentHost = new URL(experimentURL).host.replace(':', '_');
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

function perfRootFor(resultsRoot: string, viewport: Viewport): string {
  return path.join(resultsRoot, `perf-${viewport.label}`);
}

function createPhaseProgress(
  stageName: string,
  skipOption: string,
  totalSamples: number | null,
): PhaseProgress {
  return {
    stageName,
    skipOption,
    start: Date.now(),
    completed: 0,
    totalSamples,
  };
}

function printSampleStart(
  context: TestContext,
  phaseProgress: PhaseProgress,
  group: string,
  iteration: number,
  isTrial: boolean,
): void {
  const averageMs = phaseProgress.completed > 0
    ? (Date.now() - phaseProgress.start) / phaseProgress.completed
    : 0;
  const remaining = phaseProgress.totalSamples == null
    ? 0
    : Math.max(0, phaseProgress.totalSamples - phaseProgress.completed);
  const remainingTime = secondsToTime(Math.round((remaining * averageMs) / 1000));
  const percentComplete = phaseProgress.totalSamples && phaseProgress.totalSamples > 0
    ? Math.min(100, Math.round((phaseProgress.completed / phaseProgress.totalSamples) * 100))
    : null;
  const percentText = percentComplete == null ? '' : ` ${chalk.red(`${percentComplete}%`)}`;
  const displayIteration = isTrial ? iteration : Math.max(0, iteration - 1);
  const logSubject = testSourcePrefix(
    context.testFile,
    context.line,
    context.name,
    context.viewport.label,
    'perf',
    isTrial ? 'warmup' : `sample-${displayIteration}`,
  );
  console.log(
    formatLogPrefix(logSubject, { group }) +
    `remaining time for stage ${chalk.cyan(phaseProgress.stageName)} ${chalk.red(remainingTime)}${percentText} ` +
    `(you may skip this stage with ${chalk.cyan(phaseProgress.skipOption)})`
  );
}

export async function runCompare(compareFlags: ICompareFlags): Promise<string> {
  if (compareFlags.skipLowNoiseProfiles && compareFlags.lowNoiseProfilesOnly) {
    throw new Error('--skip-low-noise-profiles and --low-noise-profiles-only are mutually exclusive');
  }
  if (!compareFlags.controlURL) {
    console.error(chalk.red("controlURL is required as a cli flag"));
    process.exit(2);
  }
  if (!compareFlags.experimentURL) {
    console.error(chalk.red("experimentURL is required as a cli flag"));
    process.exit(2);
  }
  const tests = await loadTests({
    testPathPattern: compareFlags.testPathPattern,
    filter: compareFlags.filter,
    testType: 'perf',
    log: (msg) => console.log(msg),
  });

  mkdirpSync(compareFlags.resultsFolder!);

  const resultsFolder = compareFlags.resultsFolder;
  const viewportConfigs = compareFlags.viewportConfigs ?? [{
    viewport: compareFlags.viewport,
    config: compareFlags.config,
  }];
  const configByViewport = new Map(
    viewportConfigs.map((entry) => [entry.viewport.label, entry.config])
  );

  let analyzedJSONString = "";
  const completedTests: TestInfo[] = [];
  const failedTests: { name: string; reason: string }[] = [];
  const successfulContexts: TestContext[] = [];

  const contexts: TestContext[] = planTestViewports(
    tests,
    viewportConfigs.map((entry) => entry.viewport),
  ).flatMap(({ test: testDef, viewports }) => {
    console.log(`\n${formatTestTitle(testDef.file ?? null, testDef.name, testDef.line)}`);
    const slug = testDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return viewports.map((viewport) => {
      const testResultsFolder = path.join(perfRootFor(resultsFolder, viewport), slug);
      mkdirpSync(testResultsFolder);
      const testOptions: LighthouseBenchmarkOptions = {
        viewport,
        resultsFolder: testResultsFolder,
        lhConfigPath: configByViewport.get(viewport.label),
        logFile: path.join(testResultsFolder, ENGINE_LOG_FILE),
      };
      return {
        name: testDef.name,
        testFile: testDef.file ?? null,
        line: testDef.line,
        slug: `${slug}-${viewport.label}`,
        viewport,
        resultsFolder: testResultsFolder,
        benchmarks: createBenchmarks(testDef, compareFlags, testOptions),
      };
    });
  });

  const sampleTimeoutMs = compareFlags.sampleTimeoutMs;
  const durationMs = compareFlags.duration ? compareFlags.duration * 1000 : undefined;
  const createPool = (parallelism: number) => new LighthouseSamplingWorkerPool<NavigationSample>({
    setupTimeoutMs: 5000,
    sampleTimeoutMs,
    parallelism,
    samplingMode: compareFlags.samplingMode,
    retries: compareFlags.retries,
    retryDelay: compareFlags.retryDelay,
  });
  const failedContextNames = new Set<string>();
  const contextKey = (context: TestContext) => `${context.name}\0${context.viewport.label}`;
  const recordFailure = (context: TestContext, err: unknown) => {
    const key = contextKey(context);
    if (failedContextNames.has(key)) return;
    failedContextNames.add(key);
    const error = err instanceof Error ? err : new Error(String(err));
    const reason = error.stack ?? error.message;
    foldEngineArtifactsIntoReport(context.resultsFolder, reason);
    const failBanner = `${chalkScheme.blackBgRed(
      `    ${chalkScheme.white("FAILED")}     `
    )} ${error.message}`;
    console.log(`\n${failBanner}`);
    failedTests.push({ name: context.name, reason: error.message });
  };

  const warmupSkippedByVisreg = compareFlags.warmedUpByVisreg === true;
  if (compareFlags.skipPerfWarmup || warmupSkippedByVisreg || compareFlags.lowNoiseProfilesOnly) {
    if (warmupSkippedByVisreg) {
      console.log(chalk.dim('skipping warmup already warmed up by visreg'));
    }
  } else {
    // TODO: update the auto-skip note below when accessibility and seo land
    // as categories — if either also drives the page through a real browser
    // before perf, they should pre-warm just like visreg does today.
    announceStage(
      'perf warmup',
      'Doing one throwaway run of every test before any real measurements start. ' +
      'The first time a page loads, the app and browser have to compile and cache things they will reuse on every later load. ' +
      'Including those one-time costs in the measurements would make every test look slower than what real users experience after the first visit. ' +
      'Skipped automatically if visreg already ran in this invocation, because visreg already loaded the same pages. ' +
      'Skip explicitly with --skip-perf-warmup.'
    );
    const warmupPool = createPool(compareFlags.parallelism);
    const warmupProgress = createPhaseProgress(
      'perf warmup',
      '--skip-perf-warmup',
      contexts.reduce((count, context) => count + context.benchmarks.length, 0)
    );
    try {
      await Promise.all(contexts.map(async (context) => {
        try {
          await warmUpTest(
            context.benchmarks,
            warmupPool,
            {
              testKey: context.slug,
              durationMs,
              onSampleStart: (group, iteration, isTrial) =>
                printSampleStart(context, warmupProgress, group, iteration, isTrial),
              onProgress: () => { warmupProgress.completed++; },
            }
          );
        } catch (err) {
          recordFailure(context, err);
        }
      }));
    } finally {
      await warmupPool.dispose();
    }
  }

  if (!compareFlags.lowNoiseProfilesOnly) {
    announceStage(
      'perf measurements',
      'Loading each test page many times on both the control server and the experiment server, recording how long things take. ' +
      'A single page load is too noisy to trust on its own — wifi blips, background CPU, garbage collection, all of it shifts the numbers. ' +
      'So each test is repeated many times and the comparison is made on the averages, which is what determines whether the experiment counts as a regression or an improvement. ' +
      'This is the longest stage; more samples means a more confident verdict. ' +
      'Skip this stage with --low-noise-profiles-only (jumps straight to the final debugging pass; no regression verdict will be produced).'
    );
    const measurementPool = createPool(compareFlags.parallelism);
    try {
      const measurableContexts = contexts.filter((context) => !failedContextNames.has(contextKey(context)));
      const measurementProgress = createPhaseProgress(
        'perf measurements',
        '--low-noise-profiles-only',
        durationMs
          ? null
          : measurableContexts.reduce(
            (count, context) => count + context.benchmarks.length * compareFlags.numberOfMeasurements,
            0,
          )
      );
      const measurementJobs = contexts.map((context) => {
        if (failedContextNames.has(contextKey(context))) return null;
        const startTime = timestamp();
        const promise = measureTest(
          context.benchmarks,
          compareFlags.numberOfMeasurements as number,
          measurementPool,
          {
            testKey: context.slug,
            durationMs,
            onSampleStart: (group, iteration, isTrial) =>
              printSampleStart(context, measurementProgress, group, iteration, isTrial),
            onProgress: () => { measurementProgress.completed++; },
          }
        ).then((sampleGroups) => ({ sampleGroups, startTime }));
        return { context, promise };
      });

      await Promise.all(measurementJobs.map(async (job) => {
        if (!job) return;
        const { context, promise } = job;
        try {
          const { sampleGroups, startTime } = await promise;
          const results = sampleGroups.map(({ group, samples }) => {
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
          const abMeasurementsPath = `${context.resultsFolder}/ab-measurements.json`;
          generateHtmlDiffs({
            testResultsFolder: context.resultsFolder,
            controlURL: compareFlags.controlURL!,
            experimentURL: compareFlags.experimentURL!,
          });
          writeTimelineArtifacts(context.resultsFolder, compareFlags.controlURL!, compareFlags.experimentURL!);

          writeFileSync(abMeasurementsPath, JSON.stringify(results));
          completedTests.push({
            name: context.name,
            testFile: context.testFile,
            line: context.line,
            resultsFolder: context.resultsFolder,
          });
          successfulContexts.push(context);

          const duration = secondsToTime(durationInSec(endTime, startTime));
          const actualMeasurements = results[0].samples.length;
          const message = `${chalkScheme.blackBgGreen(
            `    ${chalkScheme.white("SUCCESS")}    `
          )} ${actualMeasurements} measurements took ${duration}`;

          console.log(`\n${message}`);

          if (!compareFlags.hideAnalysis) {
            analyzedJSONString = await runAnalyze(abMeasurementsPath, {
              numberOfMeasurements: actualMeasurements,
              regressionThreshold: compareFlags.regressionThreshold!,
            regressionThresholdStat: compareFlags.regressionThresholdStat!,
            pValueThreshold: compareFlags.pValueThreshold,
            jsonReport: true,
            summaryMetadata: {
              testName: context.name,
              testFile: context.testFile,
              testLine: context.line,
              viewportLabel: context.viewport.label,
            },
          });
          }

          if (!compareFlags.skipReport) {
            try {
              await runReport({
                resultsFolder: context.resultsFolder,
                pValueThreshold: compareFlags.pValueThreshold,
              });
            } catch (err) {
              console.error(chalk.red(`Failed to generate bench HTML report for ${context.name}:`), err);
            }
          }

          foldEngineArtifactsIntoReport(context.resultsFolder, null);
        } catch (err) {
          recordFailure(context, err);
        }
      }));
    } finally {
      await measurementPool.dispose();
    }
  }

  const lowNoiseTargets = compareFlags.lowNoiseProfilesOnly ? contexts : successfulContexts;
  if (!compareFlags.skipLowNoiseProfiles && lowNoiseTargets.length > 0) {
    announceStage(
      'low-noise profiles',
      'Doing one final, careful run for each test — one at a time, with nothing else competing for CPU. ' +
      'The numbers from this stage do not affect the regression check; statistical sampling already produced that answer. ' +
      'Its purpose is to produce clean, readable Lighthouse reports, performance traces, and timelines you can open and dig into when something looks off. ' +
      'Skip this stage with --skip-low-noise-profiles.'
    );
    const lowNoisePool = createPool(1);
    const lowNoiseProgress = createPhaseProgress(
      'low-noise profiles',
      '--skip-low-noise-profiles',
      lowNoiseTargets.reduce((count, context) => count + context.benchmarks.length, 0)
    );
    try {
      await Promise.all(lowNoiseTargets.map(async (context) => {
        if (failedContextNames.has(contextKey(context)) && !compareFlags.lowNoiseProfilesOnly) return;
        const lowNoiseFolder = path.join(context.resultsFolder, 'low-noise');
        mkdirpSync(lowNoiseFolder);
        const testDef = tests.find((test) => test.name === context.name)!;
        const lowNoiseOptions: LighthouseBenchmarkOptions = {
          viewport: context.viewport,
          resultsFolder: lowNoiseFolder,
          lhConfigPath: configByViewport.get(context.viewport.label),
          logFile: path.join(lowNoiseFolder, ENGINE_LOG_FILE),
        };
        const benchmarks = createBenchmarks(testDef, compareFlags, lowNoiseOptions);
        try {
          await measureTest(
            benchmarks,
            1,
            lowNoisePool,
            {
              testKey: `${context.slug}-low-noise`,
              onSampleStart: (group, iteration, isTrial) =>
                printSampleStart(context, lowNoiseProgress, group, iteration, isTrial),
              onProgress: () => { lowNoiseProgress.completed++; },
            }
          );
          writeTimelineArtifacts(lowNoiseFolder, compareFlags.controlURL!, compareFlags.experimentURL!);
        } catch (err) {
          recordFailure(context, err);
        }
      }));
    } finally {
      await lowNoisePool.dispose();
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
