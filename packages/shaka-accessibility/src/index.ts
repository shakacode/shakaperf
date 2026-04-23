export {
  AxeGlobalConfigSchema,
  AxePerTestConfigSchema,
  DEFAULT_AXE_TAGS,
  DEFAULT_AXE_VIEWPORTS,
  defineAxeConfig,
  mergeAxeConfig,
  parseAxeGlobalConfig,
} from './config';
export type {
  AxeEffectiveConfig,
  AxeEngineOptions,
  AxeGlobalConfig,
  AxeGlobalConfigInput,
  AxePerTestConfig,
  AxePerTestConfigInput,
} from './config';
export type {
  AxeNodeTarget,
  AxeRunArtifact,
  AxeRunResult,
  AxeScan,
  AxeViolation,
  AxeViolationNode,
} from './types';
export { runAxe } from './runner';
export type { RunAxeOptions, RunAxeResult } from './runner';
export { createAxeCommand } from './cli/program';
export type { CreateAxeCommandOptions } from './cli/program';
export { runAxeCommand } from './cli/run';
export type { RunAxeCommandOptions, RunAxeCommandResult } from './cli/run';
