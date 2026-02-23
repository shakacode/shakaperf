/* eslint-disable @typescript-eslint/no-explicit-any */
export const EXTENDS = "extends";

export interface ITBConfig {
  [EXTENDS]?: string;
  plotTitle?: string;
  fidelity?: "test" | "low" | "medium" | "high" | number;
  report?: string;
  tbResultsFolder?: string;
  controlURL?: string;
  experimentURL?: string;
  regressionThreshold?: number | string;
  sampleTimeout?: number;
  debug?: boolean;
  isCIEnv?: boolean | string;
  regressionThresholdStat?: RegressionThresholdStat;
  lhPresets?: string;
  config?: string;
  [key: string]: any;
}

export type RegressionThresholdStat = "estimator" | "ci-lower" | "ci-upper";
