/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Deliberately a leaf module with TYPE-ONLY imports: `compare-pipeline.ts` is
// part of the report-shell browser bundle, and a value import of `config.ts`
// from there would drag the zod schemas (and their shaka-shared/twin-servers
// value imports) into the bundle. `config.ts` re-exports this for the
// node-side callers.

import type { AbTestsConfig, PlaywrightOptions } from './config';

/**
 * The effective browser-launch options for a stage category: the category's
 * `playwrightOptions` override (only `visreg` and `perf` have one) spread
 * over `shared.playwrightOptions`. Per-key override — an override that only
 * sets `headless` keeps the shared `browser`/`args`. Pass the per-test
 * EFFECTIVE config (ctx.config / applyPerTestConfigOverrides) so per-test
 * overrides are honoured — the per-unit engines (visreg, perf, audit) do.
 *
 * The stages that reuse one browser per worker slot (accessibility,
 * agent-readiness) launch that browser from the FILE-level config — launch
 * options (`browser`/`args`/`headless`) can't vary once the browser is up.
 * Accessibility runs the per-test `beforeNavigate` + test body on the measured
 * page, so its per-scan context re-resolves this with the per-test `ctx.config`
 * for the context/navigation/timeout options (`ignoreHTTPSErrors`, `waitTimeout`,
 * `gotoParameters`). Agent-readiness is the exception: it models an anonymous
 * crawler and runs NO hook or test body, so it stays fully file-level.
 */
export function resolvePlaywrightOptions(
  config: AbTestsConfig,
  category: 'visreg' | 'perf' | 'audit' | 'accessibility',
): PlaywrightOptions {
  const override = category === 'visreg' || category === 'perf'
    ? config[category].playwrightOptions
    : undefined;
  return { ...config.shared.playwrightOptions, ...override };
}
