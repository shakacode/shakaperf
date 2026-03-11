import { ITBConfig } from "./tb-config";

export const defaultFlagArgs: ITBConfig = {
  plotTitle: "TracerBench",
  numberOfMeasurements: 20,
  resultsFolder: "./tracerbench-results",
  regressionThreshold: 50,
  sampleTimeout: 30,
  regressionThresholdStat: "estimator",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDefaultValue(key: string): any {
  if (key in defaultFlagArgs) {
    return defaultFlagArgs[key];
  }
}
