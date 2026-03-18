/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdirSync, writeFileSync } from "fs-extra";
import * as Handlebars from "handlebars";
import { join, resolve } from "path";
import { minify } from "html-minifier-terser";
import {
  defaultFlagArgs,
  ITBConfig,
} from "../../command-config";
import {
  GenerateStats,
  ITracerBenchTraceResult,
  ParsedTitleConfigs,
} from "../../compare/generate-stats";
import parseCompareResult from "../../compare/parse-compare-result";
import { chalkScheme, logHeading } from "../../helpers/utils";
import {
  PHASE_CHART_JS_TEMPLATE_RAW,
  PHASE_DETAIL_TEMPLATE_RAW,
  REPORT_TEMPLATE_RAW,
} from "../../static";

// HANDLEBARS HELPERS
Handlebars.registerPartial("phaseChartJSSection", PHASE_CHART_JS_TEMPLATE_RAW);
Handlebars.registerPartial("phaseDetailSection", PHASE_DETAIL_TEMPLATE_RAW);
Handlebars.registerHelper("toCamel", (val) => {
  return val.replace(/-([a-z])/g, (g: string) => g[1].toUpperCase());
});
Handlebars.registerHelper("isFaster", (analysis) => {
  return analysis.hlDiff * analysis.sign > 0;
});
Handlebars.registerHelper("getQuality", (pVal, threshold) => {
  return pVal < threshold;
});
Handlebars.registerHelper("abs", (num) => {
  return Math.abs(num);
});
Handlebars.registerHelper("absSort", (num1, num2, position) => {
  const sorted = [Math.abs(num1), Math.abs(num2)];
  sorted.sort((a, b) => a - b);
  return sorted[position];
});
Handlebars.registerHelper("stringify", (ctx) => {
  return JSON.stringify(ctx);
});
Handlebars.registerHelper("logArr", (arr) => {
  return JSON.stringify(arr);
});

// CONSTANTS
const ARTIFACT_FILE_NAME = "artifact";

// TYPINGS
export interface IReportFlags {
  resultsFolder: string;
  plotTitle?: string;
}

export function resolveTitles(
  tbConfig: Partial<ITBConfig>,
  version: string,
  plotTitle?: string
): ParsedTitleConfigs {
  const reportTitles = {
    servers: [{ name: "Control" }, { name: "Experiment" }],
    plotTitle: tbConfig.plotTitle
      ? tbConfig.plotTitle
      : defaultFlagArgs.plotTitle,
    browserVersion: version,
  };

  if (plotTitle) {
    reportTitles.plotTitle = plotTitle;
  }

  return reportTitles;
}

function determineOutputFileNamePrefix(outputFolder: string): string {
  let count = 1;
  while (true) {
    const candidateHTML = join(
      outputFolder,
      `${ARTIFACT_FILE_NAME}-${count}.html`
    );
    if (!existsSync(candidateHTML)) {
      break;
    }
    count += 1;
  }
  return `artifact-${count}`;
}

function createConsumableHTML(
  controlData: ITracerBenchTraceResult,
  experimentData: ITracerBenchTraceResult,
  tbConfig: ITBConfig,
  plotTitle?: string
): string {
  const version =
    controlData.meta.browserVersion ||
    controlData.meta["product-version"] ||
    "HeadlessChrome";

  const reportTitles = resolveTitles(tbConfig, version, plotTitle);

  const { durationSection, subPhaseSections, vitalsSections, diagnosticsSections, cumulativeCharts } =
    new GenerateStats(controlData, experimentData, reportTitles);

  const template = Handlebars.compile(REPORT_TEMPLATE_RAW);

  return template({
    cumulativeCharts,
    durationSection,
    reportTitles,
    subPhaseSections,
    vitalsSections,
    diagnosticsSections,
    configsSJSONString: JSON.stringify(tbConfig, null, 4),
    sectionFormattedDataJson: JSON.stringify(subPhaseSections),
  });
}

async function generateHTML(
  controlData: ITracerBenchTraceResult,
  experimentData: ITracerBenchTraceResult,
  resultsFolder: string,
  parsedConfig: ITBConfig,
  reportPlotTitle?: string
): Promise<string> {
  const outputFileName = determineOutputFileNamePrefix(resultsFolder);
  const renderedHTML = createConsumableHTML(
    controlData,
    experimentData,
    parsedConfig,
    reportPlotTitle
  );

  const minifiedHTML = await minify(renderedHTML, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: true,
  });

  const absPathToHTML = resolve(
    join(resultsFolder, `/${outputFileName}.html`)
  );

  writeFileSync(absPathToHTML, minifiedHTML);

  return absPathToHTML;
}

function logReportPaths(
  resultsFolder: string,
  absPathToHTML: string
): void {
  const chalkBlueBold = chalkScheme.tbBranding.blue.underline.bold;

  logHeading("Benchmark Reports");
  console.log(`\nJSON: ${chalkBlueBold(`${resultsFolder}/compare.json`)}`);
  console.log(`\nHTML: ${chalkBlueBold(absPathToHTML)}\n`);
}

export async function runReport(options: IReportFlags): Promise<void> {
  const resultsFolder = options.resultsFolder ?? defaultFlagArgs.resultsFolder!;

  mkdirSync(resultsFolder, { recursive: true });

  const inputFilePath = join(resultsFolder, "compare.json");
  const { controlData, experimentData } = parseCompareResult(inputFilePath);

  const absPathToHTML = await generateHTML(
    controlData,
    experimentData,
    resultsFolder,
    { resultsFolder, plotTitle: options.plotTitle },
    options.plotTitle
  );

  logReportPaths(resultsFolder, absPathToHTML);
}
