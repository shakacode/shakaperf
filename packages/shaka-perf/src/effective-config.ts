/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import path from 'node:path';
import mergeWith from 'lodash/mergeWith.js';
import type { AbTestDefinition } from 'shaka-shared';
import { findAbTestsConfig, loadAbTestsConfig } from './config-loader';
import { parseAbTestsConfig, type AbTestsConfig } from './config';

const LOG_PREFIX = '[abtestsConfig]';
export const ABTESTS_CONFIG_PATH_ENV = 'SHAKA_PERF_ABTESTS_CONFIG_PATH';

/**
 * The one place a test's effective config is produced: the file config with the
 * test's `config` override deep-merged on top. `mergeWith` recurses the sections
 * so a defined per-test key replaces the file value and an absent one falls
 * through; the customizer makes a defined array replace wholesale (not lodash's
 * index-merge), and functions (`beforeNavigate`) carry by reference. Merged onto
 * `{}` so `fileConfig` isn't mutated. The runner computes this per test and hands
 * it to every stage, so nothing merges a test's config anywhere else.
 */
export function applyPerTestConfigOverrides(
  fileConfig: AbTestsConfig,
  test: AbTestDefinition | undefined,
): AbTestsConfig {
  const perTest = test?.config;
  if (!perTest) return fileConfig;
  return mergeWith(
    {},
    fileConfig,
    perTest,
    (_fileValue: unknown, perTestValue: unknown) =>
      Array.isArray(perTestValue) ? perTestValue : undefined,
  ) as AbTestsConfig;
}

// In-process consumers use the runner-built `ctx.config`. This module serves the
// two that can't be handed it across their boundary (the perf Lighthouse fork,
// the visreg JSON-config bridge): they rebuild the same effective config once,
// in their own process, and read from it. Parsed file config is memoized as an
// in-flight Promise (keyed by config path) so concurrent visreg units share one
// load; keyed on the Promise, not the value, so a late caller can't observe a
// half-loaded state.
let cachedFileConfig: {
  configPath: string | null;
  config: Promise<AbTestsConfig | null>;
} | undefined;

/**
 * The effective config for a test — the file config with the test's `config`
 * override merged in (the one canonical merge). For the fork / bridge consumers
 * that can't be handed the runner's `ctx.config`; they call this once and read
 * whatever they need off it. `null` when no config file resolves.
 */
export async function reconstructEffectiveConfig(
  test: AbTestDefinition | undefined,
): Promise<AbTestsConfig | null> {
  const fileConfig = await loadParsedFileConfig();
  return fileConfig ? applyPerTestConfigOverrides(fileConfig, test) : null;
}

function loadParsedFileConfig(): Promise<AbTestsConfig | null> {
  const configPath = resolveGlobalConfigPath();
  if (cachedFileConfig?.configPath === configPath) return cachedFileConfig.config;
  // Don't cache a failure — clear the memo so a later call retries.
  const pending = parseFileConfig(configPath).catch((err: unknown) => {
    cachedFileConfig = undefined;
    console.warn(
      chalk.yellow(`${LOG_PREFIX} failed to load config: ${(err as Error).message}`),
    );
    return null;
  });
  cachedFileConfig = { configPath, config: pending };
  return pending;
}

function resolveGlobalConfigPath(): string | null {
  const configPath = process.env[ABTESTS_CONFIG_PATH_ENV] || findAbTestsConfig();
  return configPath ? path.resolve(configPath) : null;
}

async function parseFileConfig(configPath: string | null): Promise<AbTestsConfig | null> {
  if (!configPath) return null;
  return parseAbTestsConfig(await loadAbTestsConfig(configPath));
}

export async function withAbTestsConfigPath<T>(
  configPath: string | null | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const previousConfigPath = process.env[ABTESTS_CONFIG_PATH_ENV];
  cachedFileConfig = undefined;

  if (configPath) {
    process.env[ABTESTS_CONFIG_PATH_ENV] = path.resolve(configPath);
  }

  try {
    return await callback();
  } finally {
    if (previousConfigPath == null) {
      delete process.env[ABTESTS_CONFIG_PATH_ENV];
    } else {
      process.env[ABTESTS_CONFIG_PATH_ENV] = previousConfigPath;
    }
    cachedFileConfig = undefined;
  }
}
