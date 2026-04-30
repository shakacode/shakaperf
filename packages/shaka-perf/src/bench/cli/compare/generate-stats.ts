import type { IConfidenceInterval, IStatsOptions } from "../../stats";
import {
  convertMicrosecondsToMS,
  roundFloatAndConvertMicrosecondsToMS,
  Stats,
} from "../../stats";

import { md5sum } from "../helpers/utils";
import { isDiagnosticMetric, diagnosticSortOrder } from "../../core/metric-groups";
export interface ParsedTitleConfigs {
  servers: Array<{ name: string }>;
  plotTitle: string | undefined;
  browserVersion: string;
}

export type Sample = {
  js: number;
  phases: Array<{
    phase: string;
    start: number;
    duration: number;
    sign: 1 | -1;
    unit: string;
  }>;
};

export interface ITracerBenchTraceResult {
  meta: {
    browserVersion: string;
    cpus: string[];
    "product-version": string;
  };
  samples: Sample[];
  set: string;
}

type FormattedStatsSamples = {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
  samplesMS: number[];
};

type Frequency = {
  labels: string[];
  control: number[];
  experiment: number[];
};

export interface HTMLSectionRenderData {
  stats: Stats;
  isSignificant: boolean;
  ciMin: number;
  ciMax: number;
  hlDiff: number;
  phase: string;
  unit: string;
  sign: -1 | 1;
  identifierHash: string;
  frequencyHash: string;
  sampleCount: number;
  servers?: Array<{ name: string }>;
  controlFormatedSamples: FormattedStatsSamples;
  experimentFormatedSamples: FormattedStatsSamples;
  frequency: Frequency;
  pValue: number;
  asPercent: IConfidenceInterval["asPercent"];
}

type ValuesByPhase = {
  [key: string]: { values: number[]; sign: -1 | 1; unit: string };
};

type ValueGen = {
  start: number;
  duration: number;
  unit: string;
};

type CumulativeChartData = {
  unit: string;
  categories: string[][];
  controlData: number[][];
  experimentData: number[][];
};

function dropNonFiniteSamples(
  control: number[],
  experiment: number[]
): { control: number[]; experiment: number[] } {
  if (control.length === experiment.length) {
    const c: number[] = [];
    const e: number[] = [];
    for (let i = 0; i < control.length; i++) {
      if (Number.isFinite(control[i]) && Number.isFinite(experiment[i])) {
        c.push(control[i]);
        e.push(experiment[i]);
      }
    }
    return { control: c, experiment: e };
  }
  return {
    control: control.filter(Number.isFinite),
    experiment: experiment.filter(Number.isFinite),
  };
}

// takes control/experimentData as raw samples in microseconds
export class GenerateStats {
  controlData: ITracerBenchTraceResult;
  experimentData: ITracerBenchTraceResult;
  reportTitles: ParsedTitleConfigs;
  confidenceLevel?: number;
  subPhaseSections: HTMLSectionRenderData[];
  vitalsSections: HTMLSectionRenderData[];
  diagnosticsSections: HTMLSectionRenderData[];
  cumulativeCharts: CumulativeChartData[];
  constructor(
    controlData: ITracerBenchTraceResult,
    experimentData: ITracerBenchTraceResult,
    reportTitles: ParsedTitleConfigs,
    confidenceLevel?: number
  ) {
    this.controlData = controlData;
    this.experimentData = experimentData;
    this.reportTitles = reportTitles;
    this.confidenceLevel = confidenceLevel;

    const { subPhaseSections } = this.generateData(
      this.controlData.samples,
      this.experimentData.samples,
      this.reportTitles
    );
    this.subPhaseSections = subPhaseSections;
    this.vitalsSections = subPhaseSections.filter((s) => !isDiagnosticMetric(s.phase));
    this.diagnosticsSections = subPhaseSections
      .filter((s) => isDiagnosticMetric(s.phase))
      .sort((a, b) => diagnosticSortOrder(a.phase) - diagnosticSortOrder(b.phase));

    this.cumulativeCharts = this.bucketCumulative(
      this.controlData.samples,
      this.experimentData.samples
    );
  }

  private generateData(
    controlDataSamples: Sample[],
    experimentDataSamples: Sample[],
    reportTitles: ParsedTitleConfigs
  ): {
    subPhaseSections: HTMLSectionRenderData[];
  } {
    const valuesByPhaseControl = this.bucketPhaseValues(controlDataSamples);
    const valuesByPhaseExperiment = this.bucketPhaseValues(
      experimentDataSamples
    );
    const subPhases = Object.keys(valuesByPhaseControl);

    const subPhaseSections: HTMLSectionRenderData[] = subPhases.map((phase) => {
      const controlValues = valuesByPhaseControl[phase];
      const experimentValues = valuesByPhaseExperiment[phase];
      const renderDataForPhase = this.formatPhaseData(
        controlValues.values,
        experimentValues.values,
        phase,
        controlValues.unit,
        controlValues.sign
      );

      renderDataForPhase.servers = reportTitles.servers;
      return renderDataForPhase as HTMLSectionRenderData;
    });

    return {
      subPhaseSections,
    };
  }

  /**
   * Extract the phases and page load time latency into sorted buckets by phase
   *
   * @param samples - Array of "sample" objects
   * @param valueGen - Calls this function to extract the value from the phase. A
   *   "phase" is passed containing duration and start
   */
  private bucketPhaseValues(
    samples: Sample[],
    valueGen: (a: ValueGen) => number = (a: ValueGen) => a.duration
  ): ValuesByPhase {
    const buckets: ValuesByPhase = {};

    samples.forEach((sample: Sample) => {
      sample.phases.forEach((phaseData) => {
        const bucket = buckets[phaseData.phase] || {
          values: [],
          sign: phaseData.sign,
          unit: phaseData.unit,
        };
        bucket.values.push(valueGen(phaseData));
        buckets[phaseData.phase] = bucket;
      });
    });

    return buckets;
  }

  /**
   * Instantiate the TB Stats Class. Format the data into HTMLSectionRenderData
   * structure.
   *
   * @param controlValues - Values for the control for the phase in microseconds not arranged
   * @param experimentValues - Values for the experiment for the phase in microseconds not arranged
   * @param phaseName - Name of the phase the values represent
   */
  private formatPhaseData(
    controlValues: number[],
    experimentValues: number[],
    phaseName: string,
    unit: string,
    sign: -1 | 1
  ): HTMLSectionRenderData {
    // Lighthouse can emit null/NaN for an audit when a metric couldn't be
    // computed (e.g. speed-index on a page slower than the trace window).
    // Drop non-finite samples before stats — pair-wise when lengths match,
    // independently otherwise — so they don't get coerced to 0 and skew the
    // median (and explode the asPercent denominator).
    const { control: cleanControl, experiment: cleanExperiment } =
      dropNonFiniteSamples(controlValues, experimentValues);

    // all stats will be converted to milliseconds and rounded to tenths
    const stats = new Stats(
      {
        control: cleanControl,
        experiment: cleanExperiment,
        name: phaseName,
        confidenceLevel: this.confidenceLevel as IStatsOptions['confidenceLevel'],
      },
      unit === "ms"
        ? roundFloatAndConvertMicrosecondsToMS
        : (a: number) => Math.round(a)
    );

    const estimatorIsSig = Math.abs(stats.estimator) >= 1 ? true : false;
    const frequency: Frequency = {
      labels: [],
      control: [],
      experiment: [],
    };
    stats.buckets.map((bucket) => {
      frequency.labels.push(`${bucket.min}-${bucket.max} ${unit}`);
      frequency.control.push(bucket.count.control);
      frequency.experiment.push(bucket.count.experiment);
    });

    return {
      stats,
      phase: phaseName,
      identifierHash: md5sum(phaseName),
      frequencyHash: md5sum(`${phaseName}-frequency`),
      isSignificant: stats.confidenceInterval.isSig && estimatorIsSig,
      unit,
      sign,
      sampleCount: stats.sampleCount.control,
      ciMin: stats.confidenceInterval.min,
      ciMax: stats.confidenceInterval.max,
      pValue: stats.confidenceInterval.pValue,
      hlDiff: stats.estimator,
      servers: undefined,
      asPercent: stats.confidenceInterval.asPercent,
      frequency,
      controlFormatedSamples: {
        min: stats.sevenFigureSummary.control.min,
        q1: stats.sevenFigureSummary.control[25],
        median: stats.sevenFigureSummary.control[50],
        q3: stats.sevenFigureSummary.control[75],
        max: stats.sevenFigureSummary.control.max,
        outliers: stats.outliers.control.outliers,
        samplesMS: stats.control,
      },
      experimentFormatedSamples: {
        min: stats.sevenFigureSummary.experiment.min,
        q1: stats.sevenFigureSummary.experiment[25],
        median: stats.sevenFigureSummary.experiment[50],
        q3: stats.sevenFigureSummary.experiment[75],
        max: stats.sevenFigureSummary.experiment.max,
        outliers: stats.outliers.experiment.outliers,
        samplesMS: stats.experiment,
      },
    };
  }

  /**
   * Bucket the data for the cumulative chart. Ensure to convert to
   * milliseconds for presentation. Does not mutate samples.
   */
  private bucketCumulative(
    controlDataSamples: Sample[],
    experimentDataSamples: Sample[]
  ): CumulativeChartData[] {
    // round and convert from micro to milliseconds
    const cumulativeValueFunc = (a: ValueGen): number => {
      if (a.unit === "ms") {
        return Math.round(convertMicrosecondsToMS(a.start + a.duration));
      } else {
        return Math.round(a.start + a.duration);
      }
    };

    const valuesByPhaseControl = this.bucketPhaseValues(
      controlDataSamples,
      cumulativeValueFunc
    );
    const valuesByPhaseExperiment = this.bucketPhaseValues(
      experimentDataSamples,
      cumulativeValueFunc
    );
    const phases = Object.keys(valuesByPhaseControl);

    const units = new Set<string>();
    phases.forEach((phase) => {
      const unit = valuesByPhaseControl[phase].unit;
      units.add(unit);
    });

    const cumulativeCharts: CumulativeChartData[] = [];
    units.forEach((unit) => {
      const filteredPhases = phases.filter(
        (phase) => valuesByPhaseControl[phase].unit === unit
      );
      cumulativeCharts.push({
        unit,
        categories: filteredPhases.map((k) => [
          k,
          valuesByPhaseControl[k].sign > 0 ? "lower=better" : "higher=better",
        ]),
        controlData: filteredPhases.map((k) => valuesByPhaseControl[k].values),
        experimentData: filteredPhases.map(
          (k) => valuesByPhaseExperiment[k].values
        ),
      });
    });
    return cumulativeCharts;
  }
}
