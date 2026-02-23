import { ITBConfig } from "./tb-config";

export const fidelityLookup = {
  test: 2,
  low: 20,
  medium: 30,
  high: 50,
};

export const defaultFlagArgs: ITBConfig = {
  plotTitle: "TracerBench",
  fidelity: "low",
  tbResultsFolder: "./tracerbench-results",
  regressionThreshold: 50,
  isCIEnv: false,
  sampleTimeout: 30,
  regressionThresholdStat: "estimator",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDefaultValue(key: string): any {
  if (key in defaultFlagArgs) {
    return defaultFlagArgs[key];
  }
}
