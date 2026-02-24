/* eslint-disable @typescript-eslint/no-explicit-any */
import { writeFileSync } from "fs-extra";
import { dirname, join } from "path";

import type { RegressionThresholdStat } from "../../command-config/tb-config";
import { CompareResults } from "../../compare/compare-results";
import {
  GenerateStats,
  ParsedTitleConfigs,
} from "../../compare/generate-stats";
import parseCompareResult from "../../compare/parse-compare-result";

export interface CompareAnalyzeFlags {
  numberOfMeasurements: number;
  regressionThreshold: number;
  regressionThresholdStat: RegressionThresholdStat;
  jsonReport: boolean;
}

export interface RunAnalyzeOptions {
  numberOfMeasurements: number;
  regressionThreshold: number;
  regressionThresholdStat: RegressionThresholdStat;
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

  const { controlData, experimentData } = parseCompareResult(resultsFile);
  const reportTitles = getReportTitles(
    "TracerBench",
    controlData.meta.browserVersion
  );

  const stats = new GenerateStats(controlData, experimentData, reportTitles);
  const compareResults = new CompareResults(
    stats,
    numberOfMeasurements,
    regressionThreshold,
    regressionThresholdStat
  );

  compareResults.logTables();
  compareResults.logSummary();

  if (jsonReport) {
    const resultFileDir = dirname(resultsFile);
    writeFileSync(
      join(resultFileDir, "report.json"),
      compareResults.stringifyJSON()
    );
  }

  return compareResults.stringifyJSON();
}
