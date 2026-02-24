/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdirSync, writeFileSync } from "fs-extra";
import * as Handlebars from "handlebars";
import { join, resolve } from "path";
import { minify } from "html-minifier-terser";
import {
  defaultFlagArgs,
  getConfig,
  ITBConfig,
} from "../../command-config";
import {
  GenerateStats,
  ITracerBenchTraceResult,
  ParsedTitleConfigs,
} from "../../compare/generate-stats";
import parseCompareResult from "../../compare/parse-compare-result";
import printToPDF from "../../compare/print-to-pdf";
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
  tbResultsFolder: string;
  config?: string;
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
  const running = true;
  while (running) {
    const candidateHTML = join(
      outputFolder,
      `${ARTIFACT_FILE_NAME}-${count}.html`
    );
    const candidatePDF = join(
      outputFolder,
      `${ARTIFACT_FILE_NAME}-${count}.pdf`
    );
    if (!existsSync(candidateHTML) && !existsSync(candidatePDF)) {
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

  const { durationSection, subPhaseSections, cumulativeCharts } =
    new GenerateStats(controlData, experimentData, reportTitles);

  const template = Handlebars.compile(REPORT_TEMPLATE_RAW);

  return template({
    cumulativeCharts,
    durationSection,
    reportTitles,
    subPhaseSections,
    configsSJSONString: JSON.stringify(tbConfig, null, 4),
    sectionFormattedDataJson: JSON.stringify(subPhaseSections),
  });
}

async function printPDF(
  controlData: ITracerBenchTraceResult,
  experimentData: ITracerBenchTraceResult,
  tbResultsFolder: string,
  parsedConfig: ITBConfig,
  reportPlotTitle?: string
): Promise<{ absOutputPath: string; absPathToHTML: string }> {
  const outputFileName = determineOutputFileNamePrefix(tbResultsFolder);
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
    join(tbResultsFolder, `/${outputFileName}.html`)
  );

  writeFileSync(absPathToHTML, minifiedHTML);

  const absOutputPath = resolve(
    join(tbResultsFolder + `/${outputFileName}.pdf`)
  );

  await printToPDF(`file://${absPathToHTML}`, absOutputPath);

  return {
    absOutputPath,
    absPathToHTML,
  };
}

function logReportPaths(
  tbResultsFolder: string,
  absOutputPath: string,
  absPathToHTML: string
): void {
  const chalkBlueBold = chalkScheme.tbBranding.blue.underline.bold;

  logHeading("Benchmark Reports");
  console.log(`\nJSON: ${chalkBlueBold(`${tbResultsFolder}/compare.json`)}`);
  console.log(`\nPDF: ${chalkBlueBold(absOutputPath)}`);
  console.log(`\nHTML: ${chalkBlueBold(absPathToHTML)}\n`);
}

export async function runReport(options: IReportFlags): Promise<void> {
  const explicitFlags: string[] = [];
  if (options.tbResultsFolder) explicitFlags.push("--tbResultsFolder");
  if (options.config) explicitFlags.push("--config");
  if (options.plotTitle) explicitFlags.push("--plotTitle");

  const parsedConfig = getConfig(
    options.config ?? "tbconfig.json",
    options as any,
    explicitFlags
  );

  const { tbResultsFolder } = parsedConfig as unknown as IReportFlags;

  try {
    mkdirSync(tbResultsFolder, { recursive: true });
  } catch (e) {
    // ignore
  }

  const inputFilePath = join(tbResultsFolder, "compare.json");
  const { controlData, experimentData } = parseCompareResult(inputFilePath);

  const { absOutputPath, absPathToHTML } = await printPDF(
    controlData,
    experimentData,
    tbResultsFolder,
    parsedConfig,
    options.plotTitle
  );

  logReportPaths(tbResultsFolder, absOutputPath, absPathToHTML);
}
