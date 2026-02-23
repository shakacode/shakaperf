/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { flags as oclifFlags } from "@oclif/command";
import { IConfig } from "@oclif/config";
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
import { join } from "path";

import { getConfig, TBBaseCommand } from "../../command-config";
import {
  defaultFlagArgs,
  fidelityLookup,
} from "../../command-config/default-flag-args";
import type { RegressionThresholdStat } from "../../command-config/tb-config";
import {
  ITBConfig,
} from "../../command-config/tb-config";
import {
  config,
  controlURL,
  debug,
  experimentURL,
  fidelity,
  isCIEnv,
  lhPresets,
  regressionThreshold,
  regressionThresholdStat,
  report,
  sampleTimeout,
  tbResultsFolder,
} from "../../helpers/flags";
import {
  chalkScheme,
  durationInSec,
  secondsToTime,
  timestamp,
} from "../../helpers/utils";
import CompareAnalyze from "./analyze";
import CompareReport from "./report";

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
  isCIEnv?: boolean;
  regressionThresholdStat: RegressionThresholdStat;
  lhPresets?: string;
}

export default class Compare extends TBBaseCommand {
  public static description =
    "Compare the performance delta between an experiment and control";
  public static flags: oclifFlags.Input<any> = {
    hideAnalysis: oclifFlags.boolean({
      default: false,
      description: "Hide the the analysis output in terminal",
    }),
    fidelity: fidelity({ required: true }),
    tbResultsFolder: tbResultsFolder({ required: true }),
    controlURL: controlURL({ required: false }),
    experimentURL: experimentURL({ required: false }),
    regressionThreshold: regressionThreshold(),
    sampleTimeout: sampleTimeout(),
    config: config(),
    report,
    debug,
    isCIEnv: isCIEnv(),
    regressionThresholdStat,
    lhPresets,
  };
  public compareFlags: ICompareFlags;
  public parsedConfig: ITBConfig = defaultFlagArgs;
  // flags explicitly specified within the cli when
  // running the command. these will override all
  public explicitFlags: string[];
  public analyzedJSONString = "";
  constructor(argv: string[], config: IConfig) {
    super(argv, config);
    const { flags } = this.parse(Compare);
    this.explicitFlags = argv;
    this.compareFlags = flags as ICompareFlags;
  }

  // instantiated before this.run()
  public async init(): Promise<void> {
    const { flags } = this.parse(Compare);
    this.parsedConfig = getConfig(flags.config, flags, this.explicitFlags);
    this.compareFlags = flags as ICompareFlags;
    await this.parseFlags();
  }

  public async run(): Promise<string> {
    const { hideAnalysis } = this.compareFlags;
    const lhPresets = this.compareFlags.lhPresets;
    const options: Partial<LighthouseBenchmarkOptions> = { lhPresets };

    const control: Benchmark<NavigationSample> = createLighthouseBenchmark(
      "control",
      this.compareFlags.controlURL!,
      options
    );
    const experiment: Benchmark<NavigationSample> = createLighthouseBenchmark(
      "experiment",
      this.compareFlags.experimentURL!,
      options
    );

    // this should be directly above the instantiation of the InitialRenderBenchmarks
    if (this.parsedConfig.debug) {
      Object.entries(this.parsedConfig).forEach(([key, value]) => {
        if (value) {
          this.log(`${key}: ${JSON.stringify(value)}`);
        }
      });
    }

    const sampleTimeout = this.parsedConfig.sampleTimeout;

    const startTime = timestamp();
    const results = (
      await run(
        [control, experiment],
        this.parsedConfig.fidelity as number,
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
      this.error(
        `Could not sample from provided urls\nCONTROL: ${this.parsedConfig.controlURL}\nEXPERIMENT: ${this.parsedConfig.experimentURL}.`
      );
    }
    const resultJSONPath = `${this.parsedConfig.tbResultsFolder}/compare.json`;
    compareNetworkActivity();

    writeFileSync(resultJSONPath, JSON.stringify(results));

    const duration = secondsToTime(durationInSec(endTime, startTime));
    const message = `${chalkScheme.blackBgGreen(
      `    ${chalkScheme.white("SUCCESS")}    `
    )} ${this.parsedConfig.fidelity} test samples took ${duration}`;

    this.log(`\n${message}`);

    // if the stdout analysis is not hidden show it
    if (!hideAnalysis) {
      this.analyzedJSONString = await CompareAnalyze.run([
        resultJSONPath,
        "--fidelity",
        `${this.parsedConfig.fidelity}`,
        "--regressionThreshold",
        `${this.parsedConfig.regressionThreshold}`,
        "--isCIEnv",
        `${this.parsedConfig.isCIEnv}`,
        `--regressionThresholdStat`,
        `${this.parsedConfig.regressionThresholdStat}`,
        `--jsonReport`,
      ]);
    }

    // if we want to run the CompareReport without calling a separate command
    if (this.parsedConfig.report) {
      await CompareReport.run([
        "--tbResultsFolder",
        `${this.parsedConfig.tbResultsFolder}`,
        "--config",
        `${this.parsedConfig.config}`,
        "--isCIEnv",
        `${this.parsedConfig.isCIEnv}`,
      ]);
    }

    // with debug flag output three files
    // on config specifics
    if (this.parsedConfig.debug) {
      writeJSONSync(
        `${this.parsedConfig.tbResultsFolder}/compare-flags-settings.json`,
        JSON.stringify(Object.assign(this.parsedConfig), null, 2)
      );
    }

    return this.analyzedJSONString;
  }

  private async parseFlags(): Promise<void> {
    const {
      tbResultsFolder,
      fidelity,
      regressionThreshold,
      controlURL,
      experimentURL,
    } = this.parsedConfig as unknown as ICompareFlags;

    if (typeof fidelity === "string") {
      this.compareFlags.fidelity = parseInt(
        (fidelityLookup as any)[fidelity],
        10
      );
    }
    if (typeof regressionThreshold === "string") {
      this.parsedConfig.regressionThreshold = parseInt(regressionThreshold, 10);
    }
    if (typeof controlURL === undefined) {
      this.error(
        "controlURL is required either in the tbconfig.json or as cli flag"
      );
    }

    if (typeof experimentURL === undefined) {
      this.error(
        "experimentURL is required either in the tbconfig.json or as cli flag"
      );
    }

    // if the folder for the tracerbench results file
    // does not exist then create it
    mkdirpSync(tbResultsFolder);
  }
}
