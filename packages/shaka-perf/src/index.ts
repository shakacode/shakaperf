/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
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
