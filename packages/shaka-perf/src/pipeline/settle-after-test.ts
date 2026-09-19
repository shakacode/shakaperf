/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

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
