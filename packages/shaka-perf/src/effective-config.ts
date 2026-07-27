/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';
import mergeWith from 'lodash/mergeWith.js';
import type { AbTestDefinition } from 'shaka-shared';
import { findAbTestsConfig, loadAbTestsConfig } from './config-loader';
import { buildAbTestsConfig, type AbTestsConfig } from './config';

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

  const merged = mergeWith(
    {},
    fileConfig,
    perTest,
    (_fileValue: unknown, perTestValue: unknown) =>
      Array.isArray(perTestValue) ? perTestValue : undefined,
  );
  return buildAbTestsConfig(merged, `abTest(${JSON.stringify(test.name)})`);
}

// In-process consumers use the runner-built `ctx.config`. This module serves the
// two that can't be handed it across their boundary (the perf Lighthouse fork,
// the visreg JSON-config bridge): they rebuild the same effective config once,
// in their own process, and read from it. Parsed file config is memoized as an
// in-flight Promise (keyed by config path) so concurrent visreg units share one
// load; keyed on the Promise, not the value, so a late caller can't observe a
// half-loaded state.
let cachedFileConfig: {
  configPath: string;
  config: Promise<AbTestsConfig>;
} | undefined;

/**
 * The effective config for a test — the file config with the test's `config`
 * override merged in (the one canonical merge). For the fork / bridge consumers
 * that can't be handed the runner's `ctx.config`; they call this once and read
 * whatever they need off it. THROWS when no config file resolves or the file
 * fails to load/parse — `abtests.config.ts` is mandatory, and running a unit
 * without it would silently drop the config's setup (`beforeNavigate`
 * auth/cookie hooks above all): both sides would screenshot the same login
 * wall and pass, or perf would measure the wrong page. A missing config must
 * fail the unit, not degrade it.
 */
export async function reconstructEffectiveConfig(
  test: AbTestDefinition | undefined,
): Promise<AbTestsConfig> {
  return applyPerTestConfigOverrides(await loadParsedFileConfig(), test);
}

function loadParsedFileConfig(): Promise<AbTestsConfig> {
  const configPath = resolveGlobalConfigPath();
  if (cachedFileConfig?.configPath === configPath) return cachedFileConfig.config;
  // Don't cache a failure — clear the memo so a later call retries.
  const pending = parseFileConfig(configPath).catch((err: unknown) => {
    cachedFileConfig = undefined;
    throw err;
  });
  cachedFileConfig = { configPath, config: pending };
  return pending;
}

function resolveGlobalConfigPath(): string {
  const configPath = process.env[ABTESTS_CONFIG_PATH_ENV] || findAbTestsConfig();
  if (!configPath) {
    throw new Error(
      `${LOG_PREFIX} no abtests.config.ts found — it is required. ` +
      'Run `shaka-perf init` to create one, or pass --config <path>.',
    );
  }
  return path.resolve(configPath);
}

async function parseFileConfig(configPath: string): Promise<AbTestsConfig> {
  return buildAbTestsConfig(await loadAbTestsConfig(configPath));
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
