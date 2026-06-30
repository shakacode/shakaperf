/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
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
 * callers await the same load. `undefined` means "not started".
 */
let cachedGlobalHook: Promise<BeforeNavigateHook | null> | undefined;

function resolveGlobalBeforeNavigate(): Promise<BeforeNavigateHook | null> {
  if (cachedGlobalHook) return cachedGlobalHook;
  // Don't cache a load failure: clear the memo so a later call retries instead
  // of disabling the hook process-wide behind a single warning.
  const pending = loadGlobalBeforeNavigate().catch((err: unknown) => {
    cachedGlobalHook = undefined;
    console.warn(
      chalk.yellow(`${LOG_PREFIX} failed to load global hook from config: ${(err as Error).message}`),
    );
    return null;
  });
  cachedGlobalHook = pending;
  return pending;
}

async function loadGlobalBeforeNavigate(): Promise<BeforeNavigateHook | null> {
  const configPath = process.env[ABTESTS_CONFIG_PATH_ENV] || findAbTestsConfig();
  if (!configPath) return null;
  const config = await loadAbTestsConfig(configPath);
  const shared = config.shared as { beforeNavigate?: unknown } | undefined;
  return typeof shared?.beforeNavigate === 'function'
    ? (shared.beforeNavigate as BeforeNavigateHook)
    : null;
}

/**
 * Run the global (`shared.beforeNavigate`) then the per-test
 * (`abTest()` options `beforeNavigate`) hooks, in that order. MUST be awaited
 * before the engine navigates. Throws if a hook throws — a setup hook that
 * fails should fail the test, not be silently swallowed.
 */
export async function runBeforeNavigateHooks(
  ctx: BeforeNavigateContext,
  perTestHook: BeforeNavigateHook | undefined,
): Promise<void> {
  const globalHook = await resolveGlobalBeforeNavigate();
  if (globalHook) await globalHook(ctx);
  if (perTestHook) await perTestHook(ctx);
}
