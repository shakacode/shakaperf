/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ITBConfig {
  plotTitle?: string;
  numberOfMeasurements?: number;
  report?: string;
  tbResultsFolder?: string;
  controlURL?: string;
  experimentURL?: string;
  regressionThreshold?: number;
  sampleTimeout?: number;
  regressionThresholdStat?: RegressionThresholdStat;
  config?: string;
  [key: string]: any;
}

export type RegressionThresholdStat = "estimator" | "ci-lower" | "ci-upper";
