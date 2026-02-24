/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ITBConfig {
  plotTitle?: string;
  numberOfMeasurements?: "test" | "low" | "medium" | "high" | number;
  report?: string;
  tbResultsFolder?: string;
  controlURL?: string;
  experimentURL?: string;
  regressionThreshold?: number | string;
  sampleTimeout?: number;
  debug?: boolean;
  regressionThresholdStat?: RegressionThresholdStat;
  lhPresets?: string;
  config?: string;
  [key: string]: any;
}

export type RegressionThresholdStat = "estimator" | "ci-lower" | "ci-upper";
