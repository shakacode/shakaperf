/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export {
  ITBConfig,
  defaultFlagArgs,
} from "./command-config";
export * from "./helpers";
export * from "./compare";

export { runAnalyze } from "./commands/compare/analyze";

// Test definition API
export { abTest } from "../core/ab-test-registry";
export type { AbTestDefinition, AbTestConfig } from "../core/ab-test-registry";
