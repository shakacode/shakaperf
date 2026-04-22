/* eslint-disable no-case-declarations */
import type {
  IAsPercentage,
  IConfidenceInterval,
  ISevenFigureSummary,
} from "../../stats";
import chalk from "chalk";

import type { RegressionThresholdStat } from "../command-config/tb-config";
import { logHeading } from "../helpers/utils";
import { GenerateStats, HTMLSectionRenderData } from "./generate-stats";
import TBTable from "./tb-table";

export interface ICompareJSONResult {
  heading: string;
  phaseName: string;
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
  constructor(
    generateStats: GenerateStats,
    numberOfMeasurements: number,
    regressionThreshold: number,
    regressionThresholdStat: RegressionThresholdStat = "estimator"
  ) {
    this.numberOfMeasurements = numberOfMeasurements;
    this.regressionThreshold = regressionThreshold;
    this.regressionThresholdStat = regressionThresholdStat;

    generateStats.vitalsSections.map((section) => {
      this.vitalsTable.display.push({ stats: section.stats, unit: section.unit });
      this.vitalsResultsFormatted.push(section);
    });

    generateStats.diagnosticsSections.map((section) => {
      this.diagnosticsTable.display.push({ stats: section.stats, unit: section.unit });
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
    logHeading("Benchmark Results Summary", "log");
    const { colored } = this.buildSummaryReport();
    console.log(colored);
  }

  public anyResultsSignificant(phaseIsSigArray: boolean[]): boolean {
    return phaseIsSigArray.includes(true);
  }

  // if any phase of the experiment has regressed slower beyond the threshold limit returns false; otherwise true
  public allBelowRegressionThreshold(): boolean {
    const regressionThreshold = this.regressionThreshold;
    const sigConfidenceIntervals: IConfidenceInterval[] = [];
    const sigDeltas: number[] = [];
    // all stats
    const stats = this.vitalsTable.display.concat(this.diagnosticsTable.display);

    // only push statistics that are stat sig
    stats.map(({ stats: stat }) => {
      if (stat.confidenceInterval.isSig) {
        sigConfidenceIntervals.push(stat.confidenceInterval);
        sigDeltas.push(stat.estimator);
      }
    });

    // is below regressionThresholdStatistic
    function isBelowThreshold(n: number): boolean {
      const limit = regressionThreshold;
      // if the delta is a negative number and abs(delta) greater than threshold return false
      // eg. -1000 && 1000 > 25 = false (over threshold)
      // eg. 30 && 30 > 25 = true (under threshold)
      // regressions are negative numbers only
      // for comparison against the positive number threshold
      // the sign must be removed Math.abs()
      return n < 0 && Math.abs(n) > limit ? false : true;
    }

    switch (this.regressionThresholdStat) {
      case "estimator":
        // if the experiment is slower beyond the threshold return false;
        return sigDeltas.every(isBelowThreshold);

      case "ci-lower":
        // confidence interval lower/min deltas from all phases
        const ciLower: number[] = [];
        sigConfidenceIntervals.map((ci) => {
          // because of sign inversion on the samples
          // ci-lower = ci.max [max, min] [ci-lower, ci-upper]
          ciLower.push(ci.max);
        });
        // if the experiment is slower beyond the threshold return false;
        return ciLower.every(isBelowThreshold);

      case "ci-upper":
        // confidence interval upper/max deltas from all phases
        const ciUpper: number[] = [];
        sigConfidenceIntervals.map((ci) => {
          // because of sign inversion on the samples
          // ci-upper = ci.min [max, min] [ci-lower, ci-upper]
          ciUpper.push(ci.min);
        });
        // if the experiment is slower beyond the threshold return false;
        return ciUpper.every(isBelowThreshold);

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
