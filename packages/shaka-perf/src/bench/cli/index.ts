export {
  ITBConfig,
  defaultFlagArgs,
} from "./command-config";
export * from "./helpers";
export * from "./compare";

export { runCompare } from "./commands/compare";
export { runAnalyze } from "./commands/compare/analyze";

// Test definition API
export { abTest } from "../core/ab-test-registry";
export type { AbTestDefinition, AbTestOptions } from "../core/ab-test-registry";

// Config API
export { defineConfig } from "../core/lighthouse-config";
