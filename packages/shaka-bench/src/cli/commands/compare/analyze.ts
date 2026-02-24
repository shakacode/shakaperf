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
  fidelity: number;
  regressionThreshold: number;
  regressionThresholdStat: RegressionThresholdStat;
  jsonReport: boolean;
}

export interface RunAnalyzeOptions {
  fidelity: string | number;
  regressionThreshold: string | number;
  regressionThresholdStat: RegressionThresholdStat;
  jsonReport?: boolean;
}

function parseFidelity(fidelity: string | number): number {
  if (typeof fidelity === "string") {
    if (Number.isInteger(parseInt(fidelity, 10))) {
      return parseInt(fidelity, 10);
    }
    if (Object.keys(fidelityLookup).includes(fidelity)) {
      return parseInt((fidelityLookup as any)[fidelity], 10);
    }
  }
  return typeof fidelity === "number" ? fidelity : 0;
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
  const fidelity = parseFidelity(options.fidelity);
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
    fidelity,
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
