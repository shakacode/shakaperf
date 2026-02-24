import { IReportFlags } from "./commands/compare/report";

export {
  getConfig,
  ITBConfig,
  defaultFlagArgs,
} from "./command-config";
export * from "./helpers";
export * from "./compare";

export { runCompare } from "./commands/compare";
export { runAnalyze } from "./commands/compare/analyze";
export { runReport } from "./commands/compare/report";

// API backwards compat exports
export { IReportFlags };
