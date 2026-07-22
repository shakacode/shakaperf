/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * The single, uniform per-test config merge: overlay a test's per-test section
 * (`test.config.<section>`) on the project's file config for that section. Every
 * defined per-test key REPLACES the file value wholesale — scalars and arrays
 * alike (an array is not unioned with the file's; the per-test list is taken as
 * given). `undefined` per-test keys fall through to the file value. This is the
 * one place per-test overrides are resolved, so every engine agrees on what "the
 * effective config for this test" means.
 *
 * Lives in shaka-perf (not shaka-shared) because both callers — the visreg and
 * accessibility engines — are here; shaka-shared owns only the `PerTestConfig`
 * type they merge.
 */
export function mergePerTestSection<T extends object>(
  global: T,
  perTest: Partial<T> | undefined,
): T {
  const out: T = { ...global };
  if (!perTest) return out;
  for (const key of Object.keys(perTest) as (keyof T)[]) {
    const value = perTest[key];
    if (value !== undefined) out[key] = value as T[keyof T];
  }
  return out;
}
