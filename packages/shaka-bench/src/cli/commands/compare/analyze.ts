/* eslint-disable @typescript-eslint/no-explicit-any */
import { writeFileSync } from "fs-extra";
import { dirname, join } from "path";

import { fidelityLookup } from "../../command-config/default-flag-args";
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
  numberOfMeasurements: string | number;
  regressionThreshold: string | number;
  regressionThresholdStat: RegressionThresholdStat;
  jsonReport?: boolean;
}

function parseNumberOfMeasurements(value: string | number): number {
  if (typeof value === "string") {
    if (Number.isInteger(parseInt(value, 10))) {
      return parseInt(value, 10);
    }
    if (Object.keys(fidelityLookup).includes(value)) {
      return parseInt((fidelityLookup as any)[value], 10);
    }
  }
  return typeof value === "number" ? value : 0;
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
  const numberOfMeasurements = parseNumberOfMeasurements(options.numberOfMeasurements);
  const regressionThreshold =
    typeof options.regressionThreshold === "string"
      ? parseInt(options.regressionThreshold, 10)
      : options.regressionThreshold;
  const { regressionThresholdStat } = options;
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
