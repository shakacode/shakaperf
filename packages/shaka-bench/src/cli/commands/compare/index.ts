/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  Benchmark,
  compareNetworkActivity,
  createLighthouseBenchmark,
  LighthouseBenchmarkOptions,
  NavigationSample,
  run,
} from "../../../core";
import {
  mkdirpSync,
  writeFileSync,
  writeJSONSync,
} from "fs-extra";

import {
  fidelityLookup,
} from "../../command-config/default-flag-args";
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
  debug: boolean;
  regressionThreshold?: number;
  sampleTimeout: number;
  report?: boolean;
  regressionThresholdStat: RegressionThresholdStat;
  lhPresets?: string;
}

export async function runCompare(flags: Record<string, any>): Promise<string> {
  const compareFlags = { ...flags } as ICompareFlags;

  // Parse numberOfMeasurements
  const nVal = compareFlags.numberOfMeasurements;
  if (typeof nVal === "string") {
    if (nVal in fidelityLookup) {
      compareFlags.numberOfMeasurements = (fidelityLookup as any)[nVal];
    } else {
      compareFlags.numberOfMeasurements = parseInt(nVal, 10);
    }
  }
  if (typeof compareFlags.regressionThreshold === "string") {
    compareFlags.regressionThreshold = parseInt(compareFlags.regressionThreshold, 10);
  }
  if (!compareFlags.controlURL) {
    console.error("controlURL is required as a cli flag");
    process.exit(2);
  }
  if (!compareFlags.experimentURL) {
    console.error("experimentURL is required as a cli flag");
    process.exit(2);
  }

  mkdirpSync(compareFlags.tbResultsFolder!);

  const lhPresets = compareFlags.lhPresets;
  const options: Partial<LighthouseBenchmarkOptions> = { lhPresets };

  const control: Benchmark<NavigationSample> = createLighthouseBenchmark(
    "control",
    compareFlags.controlURL!,
    options
  );
  const experiment: Benchmark<NavigationSample> = createLighthouseBenchmark(
    "experiment",
    compareFlags.experimentURL!,
    options
  );

  if (compareFlags.debug) {
    Object.entries(compareFlags).forEach(([key, value]) => {
      if (value) {
        console.log(`${key}: ${JSON.stringify(value)}`);
      }
    });
  }

  const sampleTimeout = compareFlags.sampleTimeout;

  const startTime = timestamp();
  const results = (
    await run(
      [control, experiment],
      compareFlags.numberOfMeasurements as number,
      (elasped, completed, remaining, group, iteration) => {
        if (completed > 0) {
          const average = elasped / completed;
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

  let analyzedJSONString = "";

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

  // with debug flag output three files on config specifics
  if (compareFlags.debug) {
    writeJSONSync(
      `${compareFlags.tbResultsFolder}/compare-flags-settings.json`,
      JSON.stringify(Object.assign(compareFlags), null, 2)
    );
  }

  return analyzedJSONString;
}
