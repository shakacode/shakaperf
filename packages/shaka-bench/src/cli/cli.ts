#!/usr/bin/env node

import { Command } from "commander";
import { getDefaultValue, fidelityLookup } from "./command-config/default-flag-args";
import { runCompare } from "./commands/compare";
import { runAnalyze } from "./commands/compare/analyze";
import { runReport } from "./commands/compare/report";

const program = new Command();

program
  .name("shaka-bench")
  .description("Benchmarking tools for React and React on Rails apps")
  .version("0.0.2");

program
  .command("compare")
  .description(
    "Compare the performance delta between an experiment and control"
  )
  .option("--hideAnalysis", "Hide the analysis output in terminal", false)
  .option(
    "-n, --numberOfMeasurements <value>",
    `Number of measurements: ${Object.keys(fidelityLookup).join(", ")} or 2-100`,
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
    getDefaultValue("regressionThreshold")
  )
  .option(
    "--sampleTimeout <seconds>",
    "Seconds to wait for a sample",
    getDefaultValue("sampleTimeout")
  )
  .option("--report", "Generate a PDF report after compare", false)
  .option("--debug", "Debug flag, outputs verbose information", false)
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
    "-n, --numberOfMeasurements <value>",
    `Number of measurements: ${Object.keys(fidelityLookup).join(", ")} or 2-100`,
    getDefaultValue("numberOfMeasurements")
  )
  .option(
    "--regressionThreshold <ms>",
    "Upper limit the experiment can regress slower in ms",
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
    'Generates report files (PDF/HTML) from the "tracerbench compare" command output'
  )
  .option(
    "--tbResultsFolder <path>",
    "The output folder path for all tracerbench results",
    getDefaultValue("tbResultsFolder")
  )
  .option("--plotTitle <title>", "Title of the report pdf/html files")
  .action(async (opts: Record<string, unknown>) => {
    await runReport(opts as any);
  });

program.parse();
