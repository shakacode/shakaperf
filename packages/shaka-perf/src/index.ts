// Bench exports
export {
  ITBConfig,
  defaultFlagArgs,
  runCompare,
  runAnalyze,
} from './bench/cli';
export * from './bench/cli/helpers';
export * from './bench/cli/compare';
export { abTest } from './bench/core/ab-test-registry';
export type { AbTestDefinition, AbTestOptions } from './bench/core/ab-test-registry';

// Twin-servers exports
export { defineConfig as defineTwinServersConfig } from './twin-servers/config';
export type { TwinServersConfig, TwinServersConfigInput, ResolvedConfig } from './twin-servers/types';
