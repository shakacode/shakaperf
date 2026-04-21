/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from "node:path";
import { readdirSync, statSync } from "node:fs";

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
import { loadTests } from "shaka-shared";
import {
  mkdirpSync,
  writeFileSync,
} from "fs-extra";

import type { RegressionThresholdStat, SamplingMode } from "../../command-config/tb-config";
import {
  chalkScheme,
  durationInSec,
  logHeading,
  secondsToTime,
  timestamp,
} from "../../helpers/utils";
import { runAnalyze } from "./analyze";
import { runReport } from "./report";

export interface ICompareFlags {
  hideAnalysis: boolean;
  numberOfMeasurements: number;
  resultsFolder: string;
  controlURL: string | undefined;
  experimentURL: string | undefined;
  testFile: string | undefined;
  testPathPattern: string | undefined;
  filter: string | undefined;
  regressionThreshold?: number;
  sampleTimeout: number;
  skipReport?: boolean;
  regressionThresholdStat: RegressionThresholdStat;
  pValueThreshold: number;
  parallelism: number;
  samplingMode: SamplingMode;
  duration?: number;
  config?: string;
}

const ARTIFACT_DESCRIPTIONS: Record<string, string> = {
  'ab-measurements.json': 'Raw measurement samples',
  'report.json': 'Statistical analysis (JSON)',
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
  testFile: string;
  line: number | null;
  resultsFolder: string;
}

function formatTestTitle(testFile: string, name: string, line?: number | null): string {
  const loc = line ? `${testFile}:${line}` : testFile;
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
    testFile: compareFlags.testFile,
    testPathPattern: compareFlags.testPathPattern,
    filter: compareFlags.filter,
    log: (msg) => console.log(msg),
  });

  mkdirpSync(compareFlags.resultsFolder!);

  const resultsFolder = compareFlags.resultsFolder;
  const options: Partial<LighthouseBenchmarkOptions> = {
    resultsFolder,
    lhConfigPath: compareFlags.config,
  };

  let analyzedJSONString = "";
  const completedTests: TestInfo[] = [];

  for (const testDef of tests) {
    console.log(`\n${formatTestTitle(compareFlags.testFile!, testDef.name, testDef.line)}`);

    const slug = testDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const testResultsFolder = `${resultsFolder}/${slug}`;
    mkdirpSync(testResultsFolder);

    const testOptions: Partial<LighthouseBenchmarkOptions> = {
      ...options,
      resultsFolder: testResultsFolder,
    };

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

    const sampleTimeout = compareFlags.sampleTimeout;

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
          sampleTimeoutMs: sampleTimeout && sampleTimeout * 1000,
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
      console.error(
        `Could not sample from provided urls\nCONTROL: ${compareFlags.controlURL}\nEXPERIMENT: ${compareFlags.experimentURL}.`
      );
      process.exit(2);
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
    completedTests.push({ name: testDef.name, testFile: compareFlags.testFile!, line: testDef.line, resultsFolder: testResultsFolder });

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

  }

  // List all generated artifacts per test
  logHeading("Generated Artifacts", "log");
  for (const test of completedTests) {
    console.log(`\n${formatTestTitle(test.testFile, test.name, test.line)}`);
    listArtifacts(test.resultsFolder, test.resultsFolder);
  }
  console.log('');

  return analyzedJSONString;
}
