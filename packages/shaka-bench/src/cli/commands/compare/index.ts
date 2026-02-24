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

import { getConfig } from "../../command-config";
import {
  defaultFlagArgs,
  fidelityLookup,
} from "../../command-config/default-flag-args";
import type { RegressionThresholdStat } from "../../command-config/tb-config";
import {
  ITBConfig,
} from "../../command-config/tb-config";
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
  fidelity: number;
  tbResultsFolder: string;
  controlURL: string | undefined;
  experimentURL: string | undefined;
  debug: boolean;
  regressionThreshold?: number;
  sampleTimeout: number;
  config?: string;
  report?: boolean;
  regressionThresholdStat: RegressionThresholdStat;
  lhPresets?: string;
}

export async function runCompare(flags: Record<string, any>): Promise<string> {
  const explicitFlags: string[] = [];
  for (const key of Object.keys(flags)) {
    explicitFlags.push(`--${key}`);
  }

  const parsedConfig: ITBConfig = getConfig(
    flags.config ?? "tbconfig.json",
    flags,
    explicitFlags
  );

  // Parse fidelity
  let compareFlags = { ...flags } as ICompareFlags;
  const fidelityVal = parsedConfig.fidelity;
  if (typeof fidelityVal === "string") {
    compareFlags.fidelity = parseInt(
      (fidelityLookup as any)[fidelityVal],
      10
    );
  }
  if (typeof parsedConfig.regressionThreshold === "string") {
    parsedConfig.regressionThreshold = parseInt(parsedConfig.regressionThreshold, 10);
  }
  if (typeof parsedConfig.controlURL === undefined) {
    console.error(
      "controlURL is required either in the tbconfig.json or as cli flag"
    );
    process.exit(2);
  }
  if (typeof parsedConfig.experimentURL === undefined) {
    console.error(
      "experimentURL is required either in the tbconfig.json or as cli flag"
    );
    process.exit(2);
  }

  mkdirpSync(parsedConfig.tbResultsFolder!);

  const lhPresets = parsedConfig.lhPresets;
  const options: Partial<LighthouseBenchmarkOptions> = { lhPresets };

  const control: Benchmark<NavigationSample> = createLighthouseBenchmark(
    "control",
    parsedConfig.controlURL!,
    options
  );
  const experiment: Benchmark<NavigationSample> = createLighthouseBenchmark(
    "experiment",
    parsedConfig.experimentURL!,
    options
  );

  if (parsedConfig.debug) {
    Object.entries(parsedConfig).forEach(([key, value]) => {
      if (value) {
        console.log(`${key}: ${JSON.stringify(value)}`);
      }
    });
  }

  const sampleTimeout = parsedConfig.sampleTimeout;

  const startTime = timestamp();
  const results = (
    await run(
      [control, experiment],
      parsedConfig.fidelity as number,
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
      `Could not sample from provided urls\nCONTROL: ${parsedConfig.controlURL}\nEXPERIMENT: ${parsedConfig.experimentURL}.`
    );
    process.exit(2);
  }
  const resultJSONPath = `${parsedConfig.tbResultsFolder}/compare.json`;
  compareNetworkActivity();

  writeFileSync(resultJSONPath, JSON.stringify(results));

  const duration = secondsToTime(durationInSec(endTime, startTime));
  const message = `${chalkScheme.blackBgGreen(
    `    ${chalkScheme.white("SUCCESS")}    `
  )} ${parsedConfig.fidelity} test samples took ${duration}`;

  console.log(`\n${message}`);

  let analyzedJSONString = "";

  // if the stdout analysis is not hidden show it
  if (!compareFlags.hideAnalysis) {
    analyzedJSONString = await runAnalyze(resultJSONPath, {
      fidelity: parsedConfig.fidelity!,
      regressionThreshold: parsedConfig.regressionThreshold!,
      regressionThresholdStat: parsedConfig.regressionThresholdStat!,
      jsonReport: true,
    });
  }

  // if we want to run the CompareReport without calling a separate command
  if (parsedConfig.report) {
    await runReport({
      tbResultsFolder: parsedConfig.tbResultsFolder!,
      config: parsedConfig.config,
    });
  }

  // with debug flag output three files on config specifics
  if (parsedConfig.debug) {
    writeJSONSync(
      `${parsedConfig.tbResultsFolder}/compare-flags-settings.json`,
      JSON.stringify(Object.assign(parsedConfig), null, 2)
    );
  }

  return analyzedJSONString;
}
