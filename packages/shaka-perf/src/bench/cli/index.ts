import { IReportFlags } from "./commands/compare/report";

export {
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

// Test definition API
export { abTest } from "../core/ab-test-registry";
export type { AbTestDefinition, AbTestOptions } from "../core/ab-test-registry";

// Config API
export { defineConfig } from "../core/lighthouse-config";
