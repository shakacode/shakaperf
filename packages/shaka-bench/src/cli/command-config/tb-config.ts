/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ITBConfig {
  plotTitle?: string;
  numberOfMeasurements?: number;
  report?: string;
  resultsFolder?: string;
  controlURL?: string;
  experimentURL?: string;
  regressionThreshold?: number;
  sampleTimeout?: number;
  regressionThresholdStat?: RegressionThresholdStat;
  pValueThreshold?: number;
  config?: string;
  [key: string]: any;
}

export type RegressionThresholdStat = "estimator" | "ci-lower" | "ci-upper";
