/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Bench exports
export {
  ITBConfig,
  defaultFlagArgs,
  runAnalyze,
} from './bench/cli';
export * from './bench/cli/helpers';
export * from './bench/cli/compare';
export { abTest } from './bench/core/ab-test-registry';
export type { AbTestDefinition, AbTestConfig } from './bench/core/ab-test-registry';

// Twin-servers exports
export { defineConfig as defineTwinServersConfig } from './twin-servers/config';
export type { TwinServersConfig, TwinServersConfigInput, ResolvedConfig } from './twin-servers/types';

// `codeCoverage.screenshotCoveragePlugin`; `'react19'` is this factory with defaults.
export { react19ScreenshotCoveragePlugin } from './audit/stages/code_coverage/source-plugins';
export type { React19SourcePluginOptions } from './audit/stages/code_coverage/source-plugins';
export type { ScreenshotCoveragePlugin, SourceLocation, SourceResolveContext } from 'shaka-shared';
