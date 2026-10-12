/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Stats, ISevenFigureSummary } from "../../../stats";
import type { GenerateStats, HTMLSectionRenderData } from "../generate-stats";
import { CompareResults } from "../compare-results";

function sevenFigureSummary(median: number): ISevenFigureSummary {
  return {
    min: median,
    10: median,
    25: median,
    50: median,
    75: median,
    90: median,
    max: median,
  };
}

function section(
  name: string,
  unit: string,
  estimator: number,
  opts: {
    ciMax?: number;
    ciMin?: number;
    isSignificant?: boolean;
    controlMedian?: number;
    experimentMedian?: number;
    sign?: -1 | 1;
  } = {},
): HTMLSectionRenderData {
  const stat = {
    name,
    estimator,
    confidenceInterval: {
      min: opts.ciMin ?? estimator,
      median: estimator,
      max: opts.ciMax ?? estimator,
      isSig: opts.isSignificant ?? true,
      pValue: 0.01,
      asPercent: {
        percentMin: 0,
        percentMedian: 0,
        percentMax: 0,
      },
    },
    sampleCount: {
      control: 10,
      experiment: 10,
    },
    sevenFigureSummary: {
      control: sevenFigureSummary(opts.controlMedian ?? 100),
      experiment: sevenFigureSummary(opts.experimentMedian ?? 100),
    },
  } as Stats;

  return {
    stats: stat,
    unit,
    isSignificant: opts.isSignificant ?? true,
    ciMin: opts.ciMin ?? estimator,
    ciMax: opts.ciMax ?? estimator,
    hlDiff: estimator,
    phase: name,
    sign: opts.sign ?? 1,
    identifierHash: "",
    frequencyHash: "",
    sampleCount: 10,
    controlFormatedSamples: {
      min: 0,
      q1: 0,
      median: opts.controlMedian ?? 100,
      q3: 0,
      max: 0,
      outliers: [],
      samplesMS: [],
    },
    experimentFormatedSamples: {
      min: 0,
      q1: 0,
      median: opts.experimentMedian ?? 100,
      q3: 0,
      max: 0,
      outliers: [],
      samplesMS: [],
    },
    frequency: {
      labels: [],
      control: [],
      experiment: [],
    },
    pValue: 0.01,
    asPercent: {
      percentMin: 0,
      percentMedian: 0,
      percentMax: 0,
    },
  };
}

function compareResults(
  sections: HTMLSectionRenderData[],
  regressionThreshold = 50,
  regressionThresholdStat: "estimator" | "ci-lower" | "ci-upper" = "estimator",
): CompareResults {
  const generateStats = {
    vitalsSections: sections,
    diagnosticsSections: [],
  } as unknown as GenerateStats;

  return new CompareResults(generateStats, 10, regressionThreshold, regressionThresholdStat);
}

describe("CompareResults regression threshold", () => {
  it("fails only when a significant regression exceeds the configured threshold", () => {
    expect(compareResults([section("FCP", "ms", -20)]).isBelowRegressionThreshold).toBe(true);
    expect(compareResults([section("FCP", "ms", -55)]).isBelowRegressionThreshold).toBe(false);
    expect(compareResults([section("js", "KB", -2)]).isBelowRegressionThreshold).toBe(true);
    expect(compareResults([section("FCP", "ms", -55, { isSignificant: false })]).isBelowRegressionThreshold).toBe(true);
  });

  it("uses metric sign for higher-is-better score regressions", () => {
    const result = compareResults([section("SEO Score", "/100", 60, { sign: -1 })]);
    const json = JSON.parse(result.stringifyJSON());

    expect(result.isBelowRegressionThreshold).toBe(false);
    expect(json.isBelowRegressionThreshold).toBe(false);
    expect(json.vitalsTableData[0].sign).toBe(-1);
  });

  it("measures the threshold on the selected CI stat", () => {
    const result = compareResults([
      section("FCP", "ms", -20, { ciMax: -80, ciMin: -10 }),
    ], 50, "ci-lower");

    expect(result.isBelowRegressionThreshold).toBe(false);
  });
});
