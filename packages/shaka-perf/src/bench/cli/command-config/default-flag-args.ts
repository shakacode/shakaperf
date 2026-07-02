/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { ITBConfig } from "./tb-config";

export const defaultFlagArgs: ITBConfig = {
  plotTitle: "TracerBench",
  numberOfMeasurements: 20,
  resultsFolder: "./tracerbench-results",
  regressionThreshold: 50,
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
