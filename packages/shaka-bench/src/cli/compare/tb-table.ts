/* eslint-disable prefer-const */
import type { Stats } from "../../stats";

import { ICompareJSONResult } from "./compare-results";

export interface TBTableEntry {
  stats: Stats;
  unit: string;
}

export default class TBTable {
  public display: TBTableEntry[];
  public isSigArray: boolean[];
  public heading: string;

  constructor(heading: string) {
    this.heading = heading;
    this.display = [];
    this.isSigArray = [];
  }

  // return table data for JSON results
  // confidence interval and estimatorDelta are inverted
  // to show a regression as a positive number
  // and an improvement as a negative number ie (N * -1)
  // JSON results, stdout, PDF, HTML have parity
  public getData(): ICompareJSONResult[] {
    const a: ICompareJSONResult[] = [];
    this.display.forEach(({ stats: stat, unit }) => {
      // flip signs in view as regression is pos (slower) and improvement is neg (faster)
      let [percentMin, percentMedian, percentMax] = Array.from(
        Object.values(stat.confidenceInterval.asPercent),
        (stat) => stat * -1
      );

      const unitSuffix = unit || '';

      a.push({
        heading: this.heading,
        phaseName: stat.name,
        isSignificant: stat.confidenceInterval.isSig,
        pValue: stat.confidenceInterval.pValue,
        estimatorDelta: `${stat.estimator * -1}${unitSuffix}`,
        controlSampleCount: stat.sampleCount.control,
        experimentSampleCount: stat.sampleCount.experiment,
        confidenceInterval: [
          `${stat.confidenceInterval.max * -1}${unitSuffix}`,
          `${stat.confidenceInterval.min * -1}${unitSuffix}`,
        ],
        controlSevenFigureSummary: stat.sevenFigureSummary.control,
        experimentSevenFigureSummary: stat.sevenFigureSummary.experiment,
        asPercent: {
          percentMin: percentMax,
          percentMedian,
          percentMax: percentMin,
        },
      });

      this.isSigArray.push(stat.confidenceInterval.isSig);
    });
    return a;
  }

}
