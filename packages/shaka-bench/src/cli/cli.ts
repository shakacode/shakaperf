#!/usr/bin/env node

import { Command } from "commander";
import { getDefaultValue } from "./command-config/default-flag-args";
import { runCompare } from "./commands/compare";
import { runAnalyze } from "./commands/compare/analyze";
import { runReport } from "./commands/compare/report";

function parseIntArg(value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Expected an integer, got "${value}"`);
  }
  return parsed;
}

const program = new Command();

program
  .name("shaka-bench")
  .description("Benchmarking tools for web applications")
  .version(require("../../package.json").version);

program
  .command("compare")
  .description(
    "Compare the performance delta between an experiment and control"
  )
  .option("--hideAnalysis", "Hide the analysis output in terminal", false)
  .option(
    "-n, --numberOfMeasurements <n>",
    "Number of measurements (2-100)",
    parseIntArg,
    getDefaultValue("numberOfMeasurements")
  )
  .option(
    "--tbResultsFolder <path>",
    "The output folder path for all tracerbench results",
    getDefaultValue("tbResultsFolder")
  )
  .option("--controlURL <url>", "Control URL to visit for compare command")
  .option(
    "--experimentURL <url>",
    "Experiment URL to visit for compare command"
  )
  .option(
    "--regressionThreshold <ms>",
    "Upper limit the experiment can regress slower in ms",
    parseIntArg,
    getDefaultValue("regressionThreshold")
  )
  .option(
    "--sampleTimeout <seconds>",
    "Seconds to wait for a sample",
    parseIntArg,
    getDefaultValue("sampleTimeout")
  )
  .option("--report", "Generate an HTML report after compare", false)
  .option(
    "--regressionThresholdStat <stat>",
    "Statistic for regression threshold (estimator, ci-lower, ci-upper)",
    getDefaultValue("regressionThresholdStat")
  )
  .option("--lhPresets <preset>", "LightHouse presets", "mobile")
  .action(async (opts: Record<string, unknown>) => {
    await runCompare(opts);
  });

program
  .command("analyze")
  .description(
    'Generates stdout report from the "tracerbench compare" command output'
  )
  .argument("<resultsFile>", "The tracerbench compare command json output file")
  .option(
    "-n, --numberOfMeasurements <n>",
    "Number of measurements (2-100)",
    parseIntArg,
    getDefaultValue("numberOfMeasurements")
  )
  .option(
    "--regressionThreshold <ms>",
    "Upper limit the experiment can regress slower in ms",
    parseIntArg,
    getDefaultValue("regressionThreshold")
  )
  .option(
    "--regressionThresholdStat <stat>",
    "Statistic for regression threshold (estimator, ci-lower, ci-upper)",
    getDefaultValue("regressionThresholdStat")
  )
  .option("--jsonReport", "Include a JSON file from the stdout report", false)
  .action(async (resultsFile: string, opts: Record<string, unknown>) => {
    await runAnalyze(resultsFile, opts as any);
  });

program
  .command("report")
  .description(
    'Generates an HTML report from the "tracerbench compare" command output'
  )
  .option(
    "--tbResultsFolder <path>",
    "The output folder path for all tracerbench results",
    getDefaultValue("tbResultsFolder")
  )
  .option("--plotTitle <title>", "Title of the report HTML file")
  .action(async (opts: Record<string, unknown>) => {
    await runReport(opts as any);
  });

program.parse();
