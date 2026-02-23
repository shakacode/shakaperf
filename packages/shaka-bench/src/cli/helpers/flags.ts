/* eslint-disable @typescript-eslint/no-explicit-any */
import { flags as oclifFlags } from "@oclif/command";

import {
  fidelityLookup,
  getDefaultValue,
} from "../command-config/default-flag-args";

export const isCIEnv = oclifFlags.build({
  description: `Provides a drastically slimmed down stdout report for CI workflows. However does NOT hide analysis.`,
  default: () => getDefaultValue("isCIEnv"),
  parse: (ci): boolean => {
    // if boolean return
    if (typeof ci === "boolean") {
      return ci;
    }
    // if string return boolean value
    return ci === "true";
  },
});

export const config = oclifFlags.build({
  description: `Specify an alternative directory rather than the project root for the tbconfig.json. This explicit config will overwrite all.`,
});

export const report = oclifFlags.boolean({
  description: `Generate a PDF report directly after running the compare command.`,
  default: false,
});

export const plotTitle = oclifFlags.build({
  default: () => getDefaultValue("plotTitle"),
  description: `Specify the title of the report pdf/html files.`,
});

export const lhPresets = oclifFlags.string({
  description: `LightHouse presets.`,
  default: "mobile",
});

export const debug = oclifFlags.boolean({
  description: `Debug flag per command. Will output noisy command`,
  default: false,
});

export const regressionThreshold: oclifFlags.Definition<string | number> =
  oclifFlags.build({
    default: () => getDefaultValue("regressionThreshold"),
    description: `The upper limit the experiment can regress slower in milliseconds. eg 50`,
    parse: (ms): number => {
      return parseInt(ms, 10);
    },
  });

export const sampleTimeout: oclifFlags.Definition<number> = oclifFlags.build({
  default: () => getDefaultValue("sampleTimeout"),
  description: `The number of seconds to wait for a sample.`,
  parse: (ms): number => {
    return parseInt(ms, 10);
  },
});

export const fidelity = oclifFlags.build({
  default: () => getDefaultValue("fidelity"),
  description: `Directly correlates to the number of samples per trace. eg. ${Object.keys(
    fidelityLookup
  )} OR any number between 2-100`,
  parse: (fidelity: string | number): number => {
    const warnMessage = `Expected --fidelity=${fidelity} to be either a number or one of: ${Object.keys(
      fidelityLookup
    )}. Defaulting to ${getDefaultValue("fidelity")}`;

    if (typeof fidelity === "string") {
      // integers are coming as string from oclif
      if (Number.isInteger(parseInt(fidelity, 10))) {
        return parseInt(fidelity, 10);
      }
      // is a string and is either test/low/med/high
      if (Object.keys(fidelityLookup).includes(fidelity)) {
        return parseInt((fidelityLookup as any)[fidelity], 10);
      } else {
        console.warn(`${warnMessage}`);
      }
    }
    return typeof fidelity === "number" ? fidelity : getDefaultValue("fidelity");
  },
});

export const tbResultsFolder = oclifFlags.build({
  default: () => getDefaultValue("tbResultsFolder"),
  description: "The output folder path for all tracerbench results",
});

export const controlURL = oclifFlags.build({
  default: () => getDefaultValue("controlURL"),
  description: "Control URL to visit for compare command",
});

export const experimentURL = oclifFlags.build({
  default: () => getDefaultValue("experimentURL"),
  description: "Experiment URL to visit for compare command",
});

export const regressionThresholdStat = oclifFlags.string({
  description: `The statistic which the regression threshold runs against.`,
  options: ["estimator", "ci-lower", "ci-upper"],
  default: () => getDefaultValue("regressionThresholdStat"),
});

export const jsonReport = oclifFlags.boolean({
  description: `Include a JSON file from the stdout report`,
  default: false,
});
