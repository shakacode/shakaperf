import { ITBConfig } from "./tb-config";

export const defaultFlagArgs: ITBConfig = {
  plotTitle: "TracerBench",
  numberOfMeasurements: 20,
  resultsFolder: "./tracerbench-results",
  regressionThreshold: 50,
  sampleTimeoutMs: 30_000,
  regressionThresholdStat: "estimator",
  pValueThreshold: 0.01,
  parallelism: 1,
  samplingMode: "simultaneous",
};

export function getDefaultValue(key: string): unknown {
  if (key in defaultFlagArgs) {
    return defaultFlagArgs[key];
  }
  return undefined;
}
