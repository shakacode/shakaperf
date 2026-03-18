/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  Benchmark,
  clearDownloadsSizes,
  compareNetworkActivity,
  createLighthouseBenchmark,
  LighthouseBenchmarkOptions,
  NavigationSample,
  run,
} from "../../../core";
import { loadTests } from "shaka-shared";
import {
  mkdirpSync,
  writeFileSync,
} from "fs-extra";

import type { RegressionThresholdStat } from "../../command-config/tb-config";
import {
  chalkScheme,
  durationInSec,
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
  regressionThreshold?: number;
  sampleTimeout: number;
  report?: boolean;
  regressionThresholdStat: RegressionThresholdStat;
  config?: string;
}

export async function runCompare(flags: Record<string, any>): Promise<string> {
  const compareFlags = { ...flags } as ICompareFlags;

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
    log: (msg) => console.log(msg),
  });

  mkdirpSync(compareFlags.resultsFolder!);

  const resultsFolder = compareFlags.resultsFolder;
  const options: Partial<LighthouseBenchmarkOptions> = {
    resultsFolder,
    lhConfigPath: compareFlags.config,
  };

  let analyzedJSONString = "";

  for (const testDef of tests) {
    console.log(`\nRunning test: ${testDef.name}`);

    const slug = testDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const testResultsFolder = `${resultsFolder}/${slug}`;
    mkdirpSync(testResultsFolder);
    clearDownloadsSizes();

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
    const resultJSONPath = `${testResultsFolder}/compare.json`;
    compareNetworkActivity();

    writeFileSync(resultJSONPath, JSON.stringify(results));

    const duration = secondsToTime(durationInSec(endTime, startTime));
    const message = `${chalkScheme.blackBgGreen(
      `    ${chalkScheme.white("SUCCESS")}    `
    )} ${compareFlags.numberOfMeasurements} measurements took ${duration}`;

    console.log(`\n${message}`);

    // if the stdout analysis is not hidden show it
    if (!compareFlags.hideAnalysis) {
      analyzedJSONString = await runAnalyze(resultJSONPath, {
        numberOfMeasurements: compareFlags.numberOfMeasurements!,
        regressionThreshold: compareFlags.regressionThreshold!,
        regressionThresholdStat: compareFlags.regressionThresholdStat!,
        jsonReport: true,
      });
    }

    // if we want to run the CompareReport without calling a separate command
    if (compareFlags.report) {
      await runReport({
        resultsFolder: testResultsFolder,
      });
    }
  }

  return analyzedJSONString;
}
