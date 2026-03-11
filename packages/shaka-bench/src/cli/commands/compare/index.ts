/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from "node:path";

import {
  Benchmark,
  compareNetworkActivity,
  createLighthouseBenchmark,
  clearRegistry,
  getRegisteredTests,
  LighthouseBenchmarkOptions,
  NavigationSample,
  run,
} from "../../../core";
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
  tbResultsFolder: string;
  controlURL: string | undefined;
  experimentURL: string | undefined;
  testFile: string | undefined;
  regressionThreshold?: number;
  sampleTimeout: number;
  report?: boolean;
  regressionThresholdStat: RegressionThresholdStat;
  config?: string;
}

async function loadTestFile(testFilePath: string): Promise<void> {
  const absolutePath = path.resolve(testFilePath);
  const ext = path.extname(absolutePath);

  if (ext === '.ts') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tsImport } = require('tsx/esm/api');
    await tsImport(absolutePath, __filename);
  } else {
    await import(absolutePath);
  }
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
  if (!compareFlags.testFile) {
    console.error("testFile is required as a cli flag");
    process.exit(2);
  }

  clearRegistry();
  await loadTestFile(compareFlags.testFile!);

  const tests = getRegisteredTests();
  if (tests.length === 0) {
    console.error(`No tests registered in ${compareFlags.testFile}. Did you call abTest()?`);
    process.exit(2);
  }

  mkdirpSync(compareFlags.tbResultsFolder!);

  const tbResultsFolder = compareFlags.tbResultsFolder;
  const options: Partial<LighthouseBenchmarkOptions> = {
    tbResultsFolder,
    lhConfigPath: compareFlags.config,
  };

  let analyzedJSONString = "";

  for (const testDef of tests) {
    console.log(`\nRunning test: ${testDef.name}`);

    const control: Benchmark<NavigationSample> = createLighthouseBenchmark(
      "control",
      compareFlags.controlURL!,
      testDef,
      options
    );
    const experiment: Benchmark<NavigationSample> = createLighthouseBenchmark(
      "experiment",
      compareFlags.experimentURL!,
      testDef,
      options
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
    const resultJSONPath = `${compareFlags.tbResultsFolder}/compare.json`;
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
        tbResultsFolder: compareFlags.tbResultsFolder!,
      });
    }
  }

  return analyzedJSONString;
}
