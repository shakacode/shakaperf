/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { z } from 'zod';
import {
  DESKTOP_VIEWPORT,
  PHONE_VIEWPORT,
  TABLET_VIEWPORT,
  type AbTestsConfigInput,
  type BeforeNavigateHook,
  type TestType,
  type Viewport,
} from 'shaka-shared';
import { TwinServersConfigSchema } from './twin-servers/types';
import type { PerfLighthouseConfig } from './bench/core/lighthouse-config';
import { DEFAULT_ACCESSIBILITY_TAGS } from './audit/stages/accessibility/defaults';

export { DEFAULT_ACCESSIBILITY_TAGS };

export const ViewportSchema: z.ZodType<Viewport> = z.object({
  label: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  formFactor: z.enum(['mobile', 'desktop']),
  deviceScaleFactor: z.number().positive(),
});

/**
 * A non-empty array of full-definition viewports with unique labels. Label
 * uniqueness is load-bearing: every per-viewport concept in the runner
 * (bucket Map keys, per-viewport unit ids, stage artifact viewport labels,
 * test-level narrowing references) keys off `viewport.label`, so a
 * duplicate would silently collapse runs and clobber artifacts.
 */
function viewportArray(defaults: [Viewport, ...Viewport[]]) {
  return z
    .array(ViewportSchema)
    .nonempty()
    .superRefine((arr, ctx) => {
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const v of arr) {
        if (seen.has(v.label)) duplicates.add(v.label);
        seen.add(v.label);
      }
      if (duplicates.size > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate viewport label(s): ${[...duplicates].join(', ')}`,
        });
      }
    })
    .default(defaults);
}

/**
 * A non-empty array of viewport LABELS (strings). Used by `visreg.viewports`
 * and `perf.viewports`, which reference the full definitions in
 * `shared.viewports`. Label-set existence (every label must be defined in
 * shared) is validated at the root schema level — we can't refine there
 * without cross-schema access.
 */
function viewportLabelArray(defaults: [string, ...string[]]) {
  return z
    .array(z.string())
    .nonempty()
    .superRefine((arr, ctx) => {
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const l of arr) {
        if (seen.has(l)) duplicates.add(l);
        seen.add(l);
      }
      if (duplicates.size > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate viewport label(s): ${[...duplicates].join(', ')}`,
        });
      }
    })
    .default(defaults);
}

export type { Viewport };

const EngineOptionsSchema = z
  .object({
    browser: z.string().optional(),
    args: z.array(z.string()).optional(),
    headless: z.boolean().optional(),
    waitTimeout: z.number().optional(),
  })
  .passthrough();

const AccessibilityEngineOptionsSchema = z
  .object({
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
    args: z.array(z.string()).optional(),
    headless: z.boolean().optional(),
    waitTimeout: z.number().int().positive().optional(),
  })
  .passthrough();

const ResembleOutputOptionsSchema = z
  .object({
    transparency: z.number().optional(),
    ignoreAntialiasing: z.boolean().optional(),
    usePreciseMatching: z.boolean().optional(),
  })
  .passthrough();

export const SharedConfigSchema = z
  .object({
    controlURL: z.string().url(),
    experimentURL: z.string().url(),
    testPathPattern: z.string().optional(),
    filter: z.string().optional(),
    /**
     * Full-definition viewports (label + dimensions + formFactor + DPR).
     * Single source of truth; `visreg.viewports` and `perf.viewports`
     * reference these by label, and per-test `options.viewports` narrows
     * which labels a given test runs at.
     */
    viewports: viewportArray([DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT]),
    parallelism: z.number().int().positive(),
    retries: z.number().int().nonnegative().default(2),
    retryDelay: z.number().int().nonnegative().default(1000),
    // Runner-level cap on every race-timeout the pipeline wraps around
    // engine work (setup, sample, etc.). Sits alongside `parallelism` /
    // `retries` because the runner is shared infrastructure — a single
    // cap covers every category's engines.
    timeoutMs: z.number().int().positive().default(120000),
    // Global pre-navigation hook (see shaka-shared `SharedConfigInput`). Runs
    // before every test's navigation on every engine; a per-test
    // `beforeNavigate` on `abTest()` options runs after it. Validated only as
    // "a function" — its behaviour is the user's.
    beforeNavigate: z
      .custom<BeforeNavigateHook>((v) => typeof v === 'function')
      .optional(),
  });

export const VisregConfigSchema = z
  .object({
    /**
     * Labels (from `shared.viewports`) that visreg runs at. Default matches
     * the three canonical devices; narrow here to skip specific breakpoints
     * for all tests, or narrow per-test via `options.viewports`.
     */
    viewports: viewportLabelArray(['desktop', 'tablet', 'phone']),
    defaultMisMatchThreshold: z.number().nonnegative().default(0.1),
    maxNumDiffPixels: z.number().int().nonnegative().default(50),
    comparePixelmatchThreshold: z.number().nonnegative().default(0.1),
    /**
     * Best-of-N screenshot stability: when a comparison doesn't match within
     * `maxNumDiffPixels`, re-navigate both pages and re-capture up to
     * `compareRetries` more times, accumulating all screenshots and picking
     * the closest pair. Distinct from `shared.retries`, which controls
     * crash-retry at the worker-pool level.
     */
    compareRetries: z.number().int().nonnegative().default(2),
    compareRetryDelay: z.number().int().nonnegative().default(5000),
    engineOptions: EngineOptionsSchema.default({
      browser: 'chromium',
      args: ['--no-sandbox'],
    }),
    resembleOutputOptions: ResembleOutputOptionsSchema.optional(),
  });

export const PerfConfigSchema = z
  .object({
    numberOfMeasurements: z.number().int().positive().default(20),
    regressionThreshold: z.number().nonnegative().default(0.1),
    pValueThreshold: z.number().min(0).max(1).default(0.05),
    regressionThresholdStat: z
      .enum(['estimator', 'ci-lower', 'ci-upper'])
      .default('estimator'),
    // 'sequential' kept only for benchmarking against simultaneous.
    samplingMode: z
      .enum(['sequential', 'simultaneous'])
      .default('simultaneous'),
    /**
     * Labels (from `shared.viewports`) that perf runs at. Default is
     * desktop + phone so device-specific regressions aren't missed.
     * Narrow here to skip breakpoints for all tests, or per-test via
     * `options.viewports`.
     */
    viewports: viewportLabelArray(['desktop', 'phone']),
    // Raw Lighthouse flags, passed straight through (the engine only layers in
    // the viewport's `formFactor` / `screenEmulation`). Set `maxWaitForLoad`
    // (ms) here to cap LH's wait for the page to fully load before it measures;
    // `DEFAULT_LH_CONFIG` supplies the fallback when unset. Runner-level
    // timeouts live on `shared.timeoutMs`.
    //
    // Runtime is a loose record (LH's flag surface drifts across versions);
    // the TS cast narrows to `PerfLighthouseConfig` so `formFactor` /
    // `screenEmulation` are compile-time errors — the user's `.ts` config
    // must be covered by their tsconfig for this to fire in CI (IDEs do
    // per-file checking regardless).
    lighthouseConfig: z
      .record(z.unknown())
      .optional() as z.ZodType<PerfLighthouseConfig | undefined>,
    plotTitle: z.string().optional(),
  });

/**
 * Audit-only knobs. Independent from `perf` — set what the audit pipeline
 * should use; if you want them to match your perf settings, copy the values
 * over. No silent inheritance. (Runner-level timeouts live on
 * `shared.timeoutMs` and cover both pipelines.)
 */
export const AuditConfigSchema = z
  .object({
    viewports: viewportLabelArray(['desktop', 'phone']),
    // Raw Lighthouse flags (same as `perf.lighthouseConfig`). Set
    // `maxWaitForLoad` here to cap LH's page-load wait; `DEFAULT_LH_CONFIG`
    // supplies the fallback when unset.
    lighthouseConfig: z
      .record(z.unknown())
      .optional() as z.ZodType<PerfLighthouseConfig | undefined>,
    // Pre-dedupe hard cap on raw screencast frames for the annotated timeline.
    // A long/slow page can emit thousands of frames; deduping them all can blow
    // the per-task timeout, so the raw stream is evenly downsampled to this cap
    // before dedupe. Defaults to 700.
    limitVideoFramesCount: z.number().int().positive().default(700),
  });

export const AccessibilityConfigSchema = z
  .object({
    viewports: viewportLabelArray(['desktop', 'phone']),
    // axe tags are category labels, not a hierarchy: `best-practice` does not
    // include WCAG rules, and WCAG AA tags do not include A tags.
    tags: z.array(z.string()).default([...DEFAULT_ACCESSIBILITY_TAGS]),
    disableRules: z.array(z.string()).default([]),
    includeRules: z.array(z.string()).optional(),
    engineOptions: AccessibilityEngineOptionsSchema.default({
      browser: 'chromium',
      args: ['--no-sandbox'],
    }),
    failOnViolation: z.boolean().default(true),
  });

export const AbTestsConfigSchema = z
  .object({
    shared: SharedConfigSchema,
    visreg: VisregConfigSchema.optional().default({}),
    perf: PerfConfigSchema.optional().default({}),
    audit: AuditConfigSchema.optional().default({}),
    accessibility: AccessibilityConfigSchema.optional().default({}),
    twinServers: TwinServersConfigSchema.optional(),
  })
  .superRefine((cfg, ctx) => {
    // Cross-schema: every category's viewport label must be defined in
    // `shared.viewports`. Catches typos ("dekstop") and wrong references
    // at parse time rather than "no viewport matched" at run time.
    const knownLabels = new Set(cfg.shared.viewports.map((v) => v.label));
    for (const category of ['visreg', 'perf', 'audit', 'accessibility'] as const) {
      for (const label of cfg[category].viewports) {
        if (!knownLabels.has(label)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [category, 'viewports'],
            message:
              `unknown viewport label "${label}" — ` +
              `define it in shared.viewports or drop it here. ` +
              `Known: ${[...knownLabels].join(', ')}`,
          });
        }
      }
    }
  });

// Zod's inferred shape: category viewports are string[]. We resolve these
// into full Viewport[] in `parseAbTestsConfig` so downstream code receives
// the same rich objects it did before the label-indirection refactor.
type AbTestsConfigParsed = z.infer<typeof AbTestsConfigSchema>;

// Compile-time alignment check between Zod's inferred input and the
// hand-written `AbTestsConfigInput` in shaka-shared. If you change either
// side, both `_zodInputSatisfiesShared` and `_sharedSatisfiesZodInput` must
// continue to type-check — otherwise the user's `defineConfig({...})` will
// either reject valid configs or accept invalid ones.
type _ZodInput = z.input<typeof AbTestsConfigSchema>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _zodInputSatisfiesShared: _ZodInput extends AbTestsConfigInput ? true : never = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _sharedSatisfiesZodInput: AbTestsConfigInput extends _ZodInput ? true : never = true;

export type SharedConfig = z.infer<typeof SharedConfigSchema>;
export type VisregConfig = Omit<z.infer<typeof VisregConfigSchema>, 'viewports'> & {
  viewports: Viewport[];
};
export type PerfConfig = Omit<z.infer<typeof PerfConfigSchema>, 'viewports'> & {
  viewports: Viewport[];
};
export type AuditConfig = Omit<z.infer<typeof AuditConfigSchema>, 'viewports'> & {
  viewports: Viewport[];
};
export type AccessibilityConfig = Omit<z.infer<typeof AccessibilityConfigSchema>, 'viewports'> & {
  viewports: Viewport[];
};
export interface AbTestsConfig {
  shared: SharedConfig;
  visreg: VisregConfig;
  perf: PerfConfig;
  audit: AuditConfig;
  accessibility: AccessibilityConfig;
  twinServers?: AbTestsConfigParsed['twinServers'];
}

/**
 * Build the complete per-stage-category viewport record the runner expects.
 * One source of truth for "which TestType maps to which config section,"
 * so adding a new category (e.g. real `accessibility`) edits only this site.
 * Categories the user hasn't configured carry empty arrays — the runner
 * skips work for stages whose category has no viewports.
 */
export function viewportsByStageCategory(
  config: AbTestsConfig,
): Record<TestType, readonly Viewport[]> {
  return {
    visreg: config.visreg.viewports,
    perf: config.perf.viewports,
    audit: config.audit.viewports,
    accessibility: config.accessibility.viewports,
  };
}

export function parseAbTestsConfig(raw: unknown): AbTestsConfig {
  const result = AbTestsConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    const first = result.error.errors[0];
    const where = first.path.join('.');
    throw new Error(where ? `${where}: ${first.message}` : first.message);
  }
  const parsed = result.data;
  if (parsed.perf.samplingMode === 'sequential') {
    console.warn(
      '[shaka-perf] perf.samplingMode "sequential" is deprecated and retained ' +
      'only for scientific comparison against "simultaneous". ' +
      'See NOISE_RESISTANT_PERF_TESTS_STUDY.md for why.'
    );
  }
  const byLabel = new Map(parsed.shared.viewports.map((v) => [v.label, v]));
  const resolve = (labels: string[]): Viewport[] =>
    labels.map((l) => byLabel.get(l)!); // safe: root superRefine validated membership
  return {
    shared: parsed.shared,
    visreg: { ...parsed.visreg, viewports: resolve(parsed.visreg.viewports) },
    perf: { ...parsed.perf, viewports: resolve(parsed.perf.viewports) },
    audit: { ...parsed.audit, viewports: resolve(parsed.audit.viewports) },
    accessibility: { ...parsed.accessibility, viewports: resolve(parsed.accessibility.viewports) },
    twinServers: parsed.twinServers,
  };
}
