/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SamplingMode } from "../../core/run";

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
  parallelism?: number;
  samplingMode?: SamplingMode;
  config?: string;
  [key: string]: any;
}

export type RegressionThresholdStat = "estimator" | "ci-lower" | "ci-upper";
export type { SamplingMode };
