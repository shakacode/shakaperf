#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { addCompareOptions } from "shaka-shared";
import { getDefaultValue } from "./command-config/default-flag-args";
import { runCompare } from "./commands/compare";
import { runAnalyze } from "./commands/compare/analyze";
import { runReport } from "./commands/compare/report";
import { runInit } from "./commands/init";

const CONFIG_FILENAME = 'bench.config.ts';

function parseIntArg(value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Expected an integer, got "${value}"`);
  }
  return parsed;
}

function parseFloatArg(value: string): number {
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Expected a number, got "${value}"`);
  }
  return parsed;
}

const program = new Command();

program
  .name("shaka-bench")
  .description("Benchmarking tools for web applications")
  .version(require("../../package.json").version);

const compareCmd = program
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
    "--resultsFolder <path>",
    "The output folder path for all tracerbench results",
    getDefaultValue("resultsFolder")
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
  .option("--config <path>", "Path to a JS/TS Lighthouse config file")
  .option("--skip-report", "Skip generating an HTML report after compare", false)
  .option(
    "--regressionThresholdStat <stat>",
    "Statistic for regression threshold (estimator, ci-lower, ci-upper)",
    getDefaultValue("regressionThresholdStat")
  )
  .option(
    "--pValueThreshold <threshold>",
    "P-value threshold for statistical significance (0 to 1)",
    parseFloatArg,
    getDefaultValue("pValueThreshold")
  )
  .action(async (opts: Record<string, unknown>) => {
    if (!opts.config) {
      const autoPath = join(process.cwd(), CONFIG_FILENAME);
      if (existsSync(autoPath)) {
        opts.config = autoPath;
      }
    }
    await runCompare(opts);
  });
addCompareOptions(compareCmd);

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
  .option(
    "--pValueThreshold <threshold>",
    "P-value threshold for statistical significance (0 to 1)",
    parseFloatArg,
    getDefaultValue("pValueThreshold")
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
    "--resultsFolder <path>",
    "The output folder path for all tracerbench results",
    getDefaultValue("resultsFolder")
  )
  .option("--plotTitle <title>", "Title of the report HTML file")
  .action(async (opts: Record<string, unknown>) => {
    await runReport(opts as any);
  });

program
  .command("init")
  .description("Generate a default Lighthouse config file")
  .action(async () => {
    await runInit();
  });

program.parse();
