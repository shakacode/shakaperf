/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/* eslint-disable no-case-declarations */
import type {
  IAsPercentage,
  ISevenFigureSummary,
  Stats,
} from "../../stats";
import chalk from "chalk";

import type { RegressionThresholdStat } from "../command-config/tb-config";
import { logHeading } from "../helpers/utils";
import { GenerateStats, HTMLSectionRenderData } from "./generate-stats";
import { classifyPracticalDelta } from "./regression-thresholds";
import TBTable from "./tb-table";

export interface ICompareJSONResult {
  heading: string;
  phaseName: string;
  sign?: -1 | 1;
  isSignificant: boolean;
  estimatorDelta: string;
  pValue: number;
  controlSampleCount: number;
  experimentSampleCount: number;
  confidenceInterval: string[];
  controlSevenFigureSummary: ISevenFigureSummary;
  experimentSevenFigureSummary: ISevenFigureSummary;
  asPercent: IAsPercentage;
}

export interface ICompareJSONResults {
  vitalsTableData: ICompareJSONResult[];
  diagnosticsTableData: ICompareJSONResult[];
  areResultsSignificant: boolean;
  isBelowRegressionThreshold: boolean;
  regressionThresholdStat: string;
}

export interface PerfSummaryMetadata {
  testName: string;
  testFile: string | null;
  testLine: number | null;
  viewportLabel?: string;
}

type PhaseResultsFormatted = Array<
  Pick<
    HTMLSectionRenderData,
    | "phase"
    | "hlDiff"
    | "isSignificant"
    | "ciMin"
    | "ciMax"
    | "pValue"
    | "asPercent"
    | "unit"
    | "sign"
  >
>;

// collect and analyze the data for the different phases for the experiment and control set and output the result to the console.
export class CompareResults {
  vitalsTable = new TBTable("LH & Vitals");
  diagnosticsTable = new TBTable("Diagnostics");
  vitalsTableData: ICompareJSONResult[];
  diagnosticsTableData: ICompareJSONResult[];
  vitalsResultsFormatted: PhaseResultsFormatted = [];
  diagnosticsResultsFormatted: PhaseResultsFormatted = [];
  areResultsSignificant = false;
  isBelowRegressionThreshold = true;
  numberOfMeasurements: number;
  regressionThreshold: number;
  regressionThresholdStat: RegressionThresholdStat;
  summaryMetadata?: PerfSummaryMetadata;
  constructor(
    generateStats: GenerateStats,
    numberOfMeasurements: number,
    regressionThreshold: number,
    regressionThresholdStat: RegressionThresholdStat = "estimator",
    summaryMetadata?: PerfSummaryMetadata,
  ) {
    this.numberOfMeasurements = numberOfMeasurements;
    this.regressionThreshold = regressionThreshold;
    this.regressionThresholdStat = regressionThresholdStat;
    this.summaryMetadata = summaryMetadata;

    generateStats.vitalsSections.map((section) => {
      this.vitalsTable.display.push({
        stats: section.stats,
        unit: section.unit,
        sign: section.sign,
      });
      this.vitalsResultsFormatted.push(section);
    });

    generateStats.diagnosticsSections.map((section) => {
      this.diagnosticsTable.display.push({
        stats: section.stats,
        unit: section.unit,
        sign: section.sign,
      });
      this.diagnosticsResultsFormatted.push(section);
    });

    this.vitalsTableData = this.vitalsTable.getData();
    this.diagnosticsTableData = this.diagnosticsTable.getData();

    // check if any result is significant on all tables
    // this statistic is from the confidence interval
    this.areResultsSignificant = this.anyResultsSignificant([
      ...this.vitalsTable.isSigArray,
      ...this.diagnosticsTable.isSigArray,
    ]);

    // if any result is significant and
    // below the set regression threshold
    // against the regressionThresholdStatistic
    if (this.areResultsSignificant) {
      this.isBelowRegressionThreshold = this.allBelowRegressionThreshold();
    }
  }

  // output meta data about the benchmark run and FYI messages to the user
  private logMetaMessagesAndWarnings(): void {
    const LOW_FIDELITY_WARNING =
      'The number of measurements was set below the recommended for a viable result. Rerun with at least "--numberOfMeasurements=low" OR >= 10';
    const REGRESSION_ALERT = `Regression found exceeding the set regression threshold of ${this.regressionThreshold} ms`;

    if (this.numberOfMeasurements < 10) {
      logHeading(LOW_FIDELITY_WARNING, "warn");
    }

    if (!this.isBelowRegressionThreshold) {
      logHeading(REGRESSION_ALERT, "alert");
    }
  }

  // generate the summary section for the results in the terminal
  // for each phase, color the significance appropriately by the HL estimated difference.
  // red for regression, green for improvement. Color with monotone if not significant.
  private formatPhaseResult(phaseData: PhaseResultsFormatted[number]): { plain: string; colored: string } {
    const { phase, pValue, hlDiff, isSignificant, ciMin, ciMax, asPercent } =
      phaseData;
    const { percentMedian, percentMax, percentMin } = asPercent;
    const displayName = phase;
    const estimatorISig = Math.abs(hlDiff) >= 1 ? true : false;
    const unit = phaseData.unit;

    if (isSignificant && estimatorISig) {
      const diffToS = (diff: number): string => {
        const negativeDiff = -diff;
        return negativeDiff > 0 ? `+${negativeDiff}` : `${negativeDiff}`;
      };

      const diffStr = `${diffToS(hlDiff)}${unit} [${diffToS(
        ciMax
      )}${unit} to ${diffToS(ciMin)}${unit}] OR ${diffToS(
        percentMedian
      )}% [${diffToS(percentMax)}% to ${diffToS(percentMin)}%]`;
      const kind = hlDiff * phaseData.sign < 0 ? "regression" : "improvement";
      const pSuffix = ` p=${pValue}`;

      const plain = `  ${displayName} estimated ${kind} ${diffStr}${pSuffix}`;
      const colorFn = kind === "regression" ? chalk.red : chalk.green;
      const colored = `  ${chalk.bold(displayName)} estimated ${kind} ${colorFn(diffStr)}${pSuffix}`;
      return { plain, colored };
    } else {
      const diffStr = `no difference [${ciMax * -1}${unit} to ${ciMin * -1}${unit}]`;
      return {
        plain: `  ${displayName} ${diffStr}`,
        colored: `  ${chalk.bold(displayName)} ${chalk.grey(diffStr)}`,
      };
    }
  }

  private buildSummaryReport(): { plain: string; colored: string } {
    const sections: { title: string; results: PhaseResultsFormatted }[] = [
      { title: "LH & Vitals", results: this.vitalsResultsFormatted },
      { title: "Diagnostics", results: this.diagnosticsResultsFormatted },
    ];

    const plainLines: string[] = ["Benchmark Results Summary"];
    const coloredLines: string[] = [];

    for (const section of sections) {
      if (section.results.length === 0) continue;
      plainLines.push(`\n${section.title}`);
      coloredLines.push(chalk.underline(`\n${section.title}`));
      for (const phaseData of section.results) {
        const { plain, colored } = this.formatPhaseResult(phaseData);
        plainLines.push(plain);
        coloredLines.push(colored);
      }
    }

    return { plain: plainLines.join("\n") + "\n", colored: coloredLines.join("\n") + "\n" };
  }

  private logStatSummaryReport(): void {
    const divider = "=".repeat(88);
    console.log("");
    console.log(chalk.bold.blue(divider));
    console.log(chalk.bold.blue("PERF STATISTICAL SUMMARY"));
    console.log(chalk.bold.blue(divider));
    if (this.summaryMetadata) {
      const location = this.summaryMetadata.testFile
        ? `${this.summaryMetadata.testFile}${this.summaryMetadata.testLine != null ? `:${this.summaryMetadata.testLine}` : ''}`
        : '(unknown source)';
      console.log(`${chalk.bold('Test:')} ${this.summaryMetadata.testName}`);
      console.log(`${chalk.bold('Location:')} ${location}`);
      if (this.summaryMetadata.viewportLabel) {
        console.log(`${chalk.bold('Viewport:')} ${this.summaryMetadata.viewportLabel}`);
      }
      console.log(chalk.bold.blue(divider));
    }
    const { colored } = this.buildSummaryReport();
    console.log(colored);
    console.log(chalk.bold.blue(divider));
    console.log("");
  }

  public anyResultsSignificant(phaseIsSigArray: boolean[]): boolean {
    return phaseIsSigArray.includes(true);
  }

  // Returns false when any significant phase has an actionable regression beyond its practical threshold.
  public allBelowRegressionThreshold(): boolean {
    // all stats
    const stats = this.vitalsTable.display.concat(this.diagnosticsTable.display);

    return stats.every(({ stats: stat, unit, sign }) => {
      if (!stat.confidenceInterval.isSig) return true;

      const direction = classifyPracticalDelta({
        phaseName: stat.name,
        directionDeltaValue: stat.estimator * -1,
        thresholdDeltaValue: this.thresholdDisplayDelta(stat),
        unit,
        isSignificant: stat.confidenceInterval.isSig,
        controlValue: stat.sevenFigureSummary.control[50],
        experimentValue: stat.sevenFigureSummary.experiment[50],
        regressionThreshold: this.regressionThreshold,
        sign,
      });

      return direction !== "regression";
    });
  }

  private thresholdDisplayDelta(stat: Pick<Stats, "estimator" | "confidenceInterval">): number {
    switch (this.regressionThresholdStat) {
      case "estimator":
        return stat.estimator * -1;
      case "ci-lower":
        // TBTable displays ci-lower from internal max because samples are sign-inverted.
        return stat.confidenceInterval.max * -1;
      case "ci-upper":
        // TBTable displays ci-upper from internal min because samples are sign-inverted.
        return stat.confidenceInterval.min * -1;
      default:
        throw new Error(`Cannot determine allBelowRegressionThreshold()`);
    }
  }

  // return the trimmed compare results in JSON format
  // this is propogated as the default return all the way up to the Compare command directly
  public stringifyJSON(): string {
    const jsonResults: ICompareJSONResults = {
      vitalsTableData: this.vitalsTableData,
      diagnosticsTableData: this.diagnosticsTableData,
      areResultsSignificant: this.areResultsSignificant,
      isBelowRegressionThreshold: this.isBelowRegressionThreshold,
      regressionThresholdStat: this.regressionThresholdStat,
    };
    return JSON.stringify(jsonResults);
  }

  public getPlainTextSummary(): string {
    return this.buildSummaryReport().plain;
  }

  public logSummary(): void {
    // log the measurement count and regression warnings
    this.logMetaMessagesAndWarnings();

    // log the summary delta with confidence interval and estimator
    this.logStatSummaryReport();
  }
}
