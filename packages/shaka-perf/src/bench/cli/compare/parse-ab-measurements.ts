import { readFileSync } from "fs-extra";
import * as JSON5 from "json5";
import { resolve } from "path";

import type { ITracerBenchTraceResult } from "./generate-stats";

export default function parseAbMeasurements(inputFilePath: string): {
  controlData: ITracerBenchTraceResult;
  experimentData: ITracerBenchTraceResult;
} {
  let inputData: ITracerBenchTraceResult[];

  try {
    inputData = JSON5.parse(readFileSync(resolve(inputFilePath), "utf8"));
    const controlData: ITracerBenchTraceResult = inputData.find((element) => {
      return element.set === "control";
    }) as ITracerBenchTraceResult;

    const experimentData = inputData.find((element) => {
      return element.set === "experiment";
    }) as ITracerBenchTraceResult;

    if (!controlData || !experimentData) {
      throw new Error(
        `The ab-measurements.json file is missing the control or experiment data. Likely the benchmark did not run`
      );
    }

    return {
      controlData,
      experimentData,
    };
  } catch (error) {
    throw new Error(
      `The ab-measurements.json cannot be parsed. Likely the benchmark did not run. Confirm ${inputFilePath} is valid JSON`
    );
  }
}
