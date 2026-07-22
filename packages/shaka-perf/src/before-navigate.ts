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
import type { BeforeNavigateContext, BeforeNavigateHook } from 'shaka-shared';
import { findAbTestsConfig, loadAbTestsConfig } from './config-loader';

const LOG_PREFIX = '[beforeNavigate]';
export const ABTESTS_CONFIG_PATH_ENV = 'SHAKA_PERF_ABTESTS_CONFIG_PATH';

/**
 * The global `shared.beforeNavigate` hook, resolved once per process.
 *
 * Why re-load the config here instead of threading the function through:
 * functions can't be serialized across the Lighthouse worker's process fork,
 * so the worker must read its own copy. `assignPortsAutomatically` is sticky
 * (returns the remembered pair without re-probing), so re-evaluating the
 * config module is side-effect-free. The in-process visreg engine resolves the
 * same way for uniformity.
 *
 * We memoize the in-flight Promise, not the resolved value. The in-process
 * visreg engine runs units concurrently when `shared.parallelism > 1`; a
 * resolved-value memo set synchronously before the async load lets a late
 * caller observe the not-yet-loaded state and skip the hook entirely (e.g. the
 * default reCAPTCHA request-blocking never installs, so `networkidle` never
 * fires and the test hangs to the pool timeout). Sharing one Promise makes all
 * callers await the same load. The cache is keyed by resolved config path so
 * long-lived processes can run different configs without reusing the first
 * hook forever.
 */
let cachedGlobalHook: {
  configPath: string | null;
  hook: Promise<BeforeNavigateHook | null>;
} | undefined;

function resolveGlobalBeforeNavigate(): Promise<BeforeNavigateHook | null> {
  const configPath = resolveGlobalConfigPath();
  if (cachedGlobalHook?.configPath === configPath) return cachedGlobalHook.hook;
  // Don't cache a load failure: clear the memo so a later call retries instead
  // of disabling the hook process-wide behind a single warning.
  const pending = loadGlobalBeforeNavigate(configPath).catch((err: unknown) => {
    cachedGlobalHook = undefined;
    console.warn(
      chalk.yellow(`${LOG_PREFIX} failed to load global hook from config: ${(err as Error).message}`),
    );
    return null;
  });
  cachedGlobalHook = { configPath, hook: pending };
  return pending;
}

function resolveGlobalConfigPath(): string | null {
  const configPath = process.env[ABTESTS_CONFIG_PATH_ENV] || findAbTestsConfig();
  return configPath ? path.resolve(configPath) : null;
}

async function loadGlobalBeforeNavigate(configPath: string | null): Promise<BeforeNavigateHook | null> {
  if (!configPath) return null;
  const config = await loadAbTestsConfig(configPath);
  const shared = config.shared as { beforeNavigate?: unknown } | undefined;
  return typeof shared?.beforeNavigate === 'function'
    ? (shared.beforeNavigate as BeforeNavigateHook)
    : null;
}

export async function withAbTestsConfigPath<T>(
  configPath: string | null | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const previousConfigPath = process.env[ABTESTS_CONFIG_PATH_ENV];
  cachedGlobalHook = undefined;

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
    cachedGlobalHook = undefined;
  }
}

/**
 * Run the `beforeNavigate` hook. MUST be awaited before the engine navigates.
 * Throws if the hook throws — a setup hook that fails should fail the test, not
 * be silently swallowed.
 *
 * A per-test hook (`abTest()` `beforeNavigate`) fully REPLACES the global
 * (`shared.beforeNavigate`) for that test — exactly one hook runs. There is no
 * chaining argument: a test that wants the global's setup too calls a shared
 * function itself (DRY). When a test has no per-test hook, the global runs.
 */
export async function runBeforeNavigateHooks(
  ctx: BeforeNavigateContext,
  perTestHook: BeforeNavigateHook | undefined,
): Promise<void> {
  const hook = perTestHook ?? (await resolveGlobalBeforeNavigate());
  if (hook) await hook(ctx);
}
