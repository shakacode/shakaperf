/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';

/**
 * Burn mode (`--burn <n>`): run every test n times as n independent instances,
 * reported separately, so a flaky test shows a mixed pass/fail column instead
 * of being papered over. It replaces retries rather than stacking on them —
 * the runner zeroes worker-pool crash-retries and the CLI passes
 * `visregCompareRetries: 0`, since a retry that rescued a run would mask the
 * very flakiness being measured.
 *
 * Modelled as "n instances of the test", not a new dimension threaded through
 * the runner — see `AbTestDefinition.burnIndex` for why.
 */

/** 1-based: `--burn 3` yields burn-1, burn-2, burn-3. */
export const FIRST_BURN_INDEX = 1;

/**
 * Copy each test once per burn instance, stamped with its index. Copies, so the
 * shared registry's definitions stay untouched — and so each instance is a
 * distinct object, which is what keeps the runner's per-test maps from
 * collapsing them.
 */
export function expandTestsForBurn(
  tests: readonly AbTestDefinition[],
  burn: number,
): AbTestDefinition[] {
  const expanded: AbTestDefinition[] = [];
  for (const test of tests) {
    for (let i = FIRST_BURN_INDEX; i < FIRST_BURN_INDEX + burn; i++) {
      expanded.push({ ...test, burnIndex: i });
    }
  }
  return expanded;
}

/**
 * The name the report shows. Only the display name is suffixed — renaming
 * `test.name` would break engines that look tests up by name (e.g. the visreg
 * runner's exact-name filter).
 */
export function burnDisplayName(test: AbTestDefinition): string {
  return test.burnIndex == null ? test.name : `${test.name}-burn-${test.burnIndex}`;
}

/** Shared so the `compare` and `audit` flags can't drift apart. */
export const BURN_OPTION_DESCRIPTION =
  'Burn-in: run every test <number> times as independent instances and report each ' +
  'separately (suffixed -burn-1 … -burn-<number>). Replaces retries — every retry is ' +
  'disabled (worker-pool crash retries and visreg best-of-N compare retries), so each ' +
  "run's raw outcome stands. Use it to surface flaky tests. Off by default.";

/**
 * Fails loudly rather than coercing: a `--burn 0` / `--burn abc` that quietly
 * became "no burn" would hand back a clean report that never burned anything.
 */
export function parseBurnOption(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const burn = Number(raw);
  if (!Number.isInteger(burn) || burn < 1) {
    throw new Error(`--burn must be a positive integer (got "${String(raw)}")`);
  }
  return burn;
}
