/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestsConfig } from '../config';

/** Shared so the `compare` and `audit` flags can't drift apart. */
export const SETTLE_AFTER_TEST_OPTION_DESCRIPTION =
  'Perf: after each test body finishes, keep measuring for <seconds> before ' +
  'Lighthouse is released, so work the page does after the last step (late ' +
  'requests, deferred renders) lands in the trace, screencast and metrics. ' +
  'Fractions allowed. 0 by default.';

/**
 * `--seconds-to-settle-after-test` in seconds, returned as milliseconds.
 * Fails loudly rather than coercing: a typo that quietly became "0" would
 * hand back a trace that never settled.
 */
export function parseSettleAfterTestOption(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const text = String(raw).trim();
  const seconds = Number(text);
  if (text === '' || !Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`--seconds-to-settle-after-test must be a non-negative number of seconds (got "${String(raw)}")`);
  }
  return Math.round(seconds * 1000);
}

/**
 * Widens `shared.timeoutMs` by the settle: a pool task runs at most a control
 * and an experiment test body, and each one waits `settleMs` after it.
 */
export function withSettleInTimeout(config: AbTestsConfig, settleMs: number | undefined): AbTestsConfig {
  if (!settleMs) return config;
  return { ...config, shared: { ...config.shared, timeoutMs: config.shared.timeoutMs + 2 * settleMs } };
}

/**
 * Keep measuring for `ms` after the test body. The period is announced
 * through the test's own `annotate`, so it shows as a labelled band on both
 * timelines and a marker line in network_activity.txt, and it is the "latest
 * annotation" if something fails while the page settles.
 */
export async function settleAfterTest(
  ms: number | undefined,
  annotate: (label: string) => Promise<void>,
): Promise<void> {
  if (!ms || ms <= 0) return;
  await annotate(`settling ${ms / 1000}s after the test`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}
