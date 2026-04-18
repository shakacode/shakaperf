export {
  AbTestsConfigSchema,
  SharedConfigSchema,
  VisregConfigSchema,
  PerfConfigSchema,
  defineConfig,
  parseAbTestsConfig,
} from './config';
export { runCompare } from './run';
export type { CompareRunOptions } from './run';
export { createCompareCommand } from './cli/program';
export type {
  AbTestsConfig,
  AbTestsConfigInput,
  SharedConfig,
  VisregConfig,
  PerfConfig,
} from './config';
