import Compare from "./commands/compare";
import CompareAnalyze from "./commands/compare/analyze";
import CompareReport, { IReportFlags } from "./commands/compare/report";

export { run } from "@oclif/command";
export {
  getConfig,
  ITBConfig,
  TBBaseCommand,
  defaultFlagArgs,
} from "./command-config";
export * from "./helpers";
export * from "./compare";

export { CompareReport, Compare, CompareAnalyze };

// API backwards compat exports
export { CompareReport as Report };
export { IReportFlags };
