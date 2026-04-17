/* eslint-disable @typescript-eslint/no-explicit-any */
import { writeFileSync } from "fs-extra";
import { dirname, join } from "path";

import type { RegressionThresholdStat } from "../../command-config/tb-config";
import { CompareResults } from "../../compare/compare-results";
import {
  GenerateStats,
  ParsedTitleConfigs,
} from "../../compare/generate-stats";
import parseAbMeasurements from "../../compare/parse-ab-measurements";

export interface CompareAnalyzeFlags {
  numberOfMeasurements: number;
  regressionThreshold: number;
  regressionThresholdStat: RegressionThresholdStat;
  pValueThreshold: number;
  jsonReport: boolean;
}

export interface RunAnalyzeOptions {
  numberOfMeasurements: number;
  regressionThreshold: number;
  regressionThresholdStat: RegressionThresholdStat;
  pValueThreshold?: number;
  jsonReport?: boolean;
}

function getReportTitles(
  plotTitle: string,
  browserVersion: string
): ParsedTitleConfigs {
  return {
    servers: [{ name: "Control" }, { name: "Experiment" }],
    plotTitle,
    browserVersion,
  };
}

export async function runAnalyze(
  resultsFile: string,
  options: RunAnalyzeOptions
): Promise<string> {
  const { numberOfMeasurements, regressionThreshold, regressionThresholdStat } = options;
  const jsonReport = options.jsonReport ?? false;
  const confidenceLevel = options.pValueThreshold != null ? 1 - options.pValueThreshold : undefined;

  const { controlData, experimentData } = parseAbMeasurements(resultsFile);
  const reportTitles = getReportTitles(
    "TracerBench",
    controlData.meta.browserVersion
  );

  const stats = new GenerateStats(controlData, experimentData, reportTitles, confidenceLevel);
  const compareResults = new CompareResults(
    stats,
    numberOfMeasurements,
    regressionThreshold,
    regressionThresholdStat
  );

  compareResults.logSummary();

  const resultFileDir = dirname(resultsFile);

  if (jsonReport) {
    writeFileSync(
      join(resultFileDir, "report.json"),
      compareResults.stringifyJSON()
    );
  }

  writeFileSync(
    join(resultFileDir, "report.txt"),
    compareResults.getPlainTextSummary()
  );

  return compareResults.stringifyJSON();
}
