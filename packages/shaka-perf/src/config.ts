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

/**
 * The one browser-launch option shape, shared by every stage. REQUIRED on
 * `shared.playwrightOptions` — there are no hidden launch defaults; what the
 * config says is what every stage launches with (the starter template supplies
 * `{ browser: 'chromium', args: ['--no-sandbox'], waitTimeout: 60_000 }`).
 * `visreg.playwrightOptions` and `perf.playwrightOptions` may override it
 * per-category with a PARTIAL of the same shape (resolved via
 * {@link resolvePlaywrightOptions}). Extra keys pass through to Playwright's
 * `launch()`. The perf (Lighthouse) engine is chromium-only and maps
 * `args`/`headless` onto its chrome-launcher flags.
 *
 * `waitTimeout` (ms) is respected by every Playwright engine (visreg,
 * accessibility, agent-readiness) the same way: the default action +
 * navigation timeout. One default (60s), set here — no per-engine fallback
 * constants; the template states it explicitly. It deliberately does NOT
 * touch the perf/audit Lighthouse engine: LH's page-load wait is a different
 * thing, configured via `lighthouseConfig.maxWaitForLoad`.
 *
 * `ignoreHTTPSErrors` defaults to TRUE on every engine (self-signed twin-server
 * certs must not fail a run): a Playwright context option on the Playwright
 * engines, `--ignore-certificate-errors` on the Lighthouse Chrome. Set `false`
 * to make every engine enforce strict certificate checking.
 */
export const PlaywrightOptionsSchema = z
  .object({
    browser: z.enum(['chromium', 'firefox', 'webkit']),
    args: z.array(z.string()).optional(),
    headless: z.boolean().optional(),
    waitTimeout: z.number().int().positive().default(60_000),
    ignoreHTTPSErrors: z.boolean().optional(),
  })
  .passthrough();

export type PlaywrightOptions = z.infer<typeof PlaywrightOptionsSchema>;

// Category override: a partial of the base shape, merged per-key over
// `shared.playwrightOptions` by `resolvePlaywrightOptions`.
const PlaywrightOptionsOverrideSchema = PlaywrightOptionsSchema.partial();

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
     * reference these by label, and a per-test `config.<category>.viewports`
     * replaces which labels a given test runs at.
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
    // `beforeNavigate` on the `abTest()` config fully replaces it for that
    // test. Validated only as "a function" — its behaviour is the user's.
    beforeNavigate: z
      .custom<BeforeNavigateHook>((v) => typeof v === 'function')
      .optional(),
    // Browser-launch options every stage respects. Required, no defaults —
    // the config states its launch options explicitly (see the template).
    // `visreg.playwrightOptions` and `perf.playwrightOptions` may override
    // per-category (partial, merged per-key).
    playwrightOptions: PlaywrightOptionsSchema,
  });

export const VisregConfigSchema = z
  .object({
    /**
     * Labels (from `shared.viewports`) that visreg runs at. Default matches
     * the three canonical devices; narrow here to skip specific breakpoints
     * for all tests, or replace per-test via `config.visreg.viewports`.
     */
    viewports: viewportLabelArray(['desktop', 'tablet', 'phone']),
    mismatchThreshold: z.number().nonnegative().default(0.1),
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
    // Category override of `shared.playwrightOptions` (partial, per-key).
    playwrightOptions: PlaywrightOptionsOverrideSchema.optional(),
    resembleOutputOptions: ResembleOutputOptionsSchema.optional(),
  });

export const PerfConfigSchema = z
  .object({
    numberOfMeasurements: z.number().int().positive().default(20),
    regressionThreshold: z.number().nonnegative().default(50),
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
     * Narrow here to skip breakpoints for all tests, or replace per-test
     * via `config.perf.viewports`.
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
    // Category override of `shared.playwrightOptions` (partial, per-key).
    // Lighthouse is chromium-only: `browser` must stay 'chromium';
    // `args`/`headless` map onto its chrome-launcher flags.
    playwrightOptions: PlaywrightOptionsOverrideSchema.optional(),
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
    failOnViolation: z.boolean().default(true),
  });

export const BisectConfigSchema = z.object({
  rebuildContainer: z.boolean().default(false),
});

export const AbTestsConfigSchema = z
  .object({
    shared: SharedConfigSchema,
    visreg: VisregConfigSchema.optional().default({}),
    perf: PerfConfigSchema.optional().default({}),
    audit: AuditConfigSchema.optional().default({}),
    accessibility: AccessibilityConfigSchema.optional().default({}),
    twinServers: TwinServersConfigSchema.optional(),
    bisect: BisectConfigSchema.optional().default({}),
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
export type VisregConfig = z.infer<typeof VisregConfigSchema>;
export type PerfConfig = z.infer<typeof PerfConfigSchema>;
export type AuditConfig = z.infer<typeof AuditConfigSchema>;
export type AccessibilityConfig = z.infer<typeof AccessibilityConfigSchema>;
export type BisectConfig = z.infer<typeof BisectConfigSchema>;

/**
 * Resolve viewport LABELS into their full `Viewport` definitions from
 * `shared.viewports`. Throws on a label with no definition — a typo'd per-test
 * override must fail loudly, not silently skip the viewport (file-level labels
 * are already schema-validated, so in practice this catches per-test lists).
 * This is the single point where the label→object indirection is turned back
 * into objects, run by whoever needs dimensions (the runner's expansion,
 * `viewportsByStageCategory`).
 */
// Lives in the type-only-imports leaf `playwright-options.ts` so the
// report-shell bundle (which value-imports it via compare-pipeline.ts) does
// not drag this module's zod schemas in. Re-exported here for node-side
// callers.
export { resolvePlaywrightOptions } from './playwright-options';

export function resolveViewports(
  labels: readonly string[],
  definitions: readonly Viewport[],
): Viewport[] {
  const byLabel = new Map(definitions.map((v) => [v.label, v]));
  return labels.map((label) => {
    const v = byLabel.get(label);
    if (!v) {
      throw new Error(
        `Unknown viewport label '${label}' — defined in shared.viewports: ` +
        `${[...byLabel.keys()].map((l) => `'${l}'`).join(', ')}.`,
      );
    }
    return v;
  });
}
export interface AbTestsConfig {
  shared: SharedConfig;
  visreg: VisregConfig;
  perf: PerfConfig;
  audit: AuditConfig;
  accessibility: AccessibilityConfig;
  twinServers?: AbTestsConfigParsed['twinServers'];
  bisect: BisectConfig;
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
  const defs = config.shared.viewports;
  return {
    visreg: resolveViewports(config.visreg.viewports, defs),
    perf: resolveViewports(config.perf.viewports, defs),
    audit: resolveViewports(config.audit.viewports, defs),
    accessibility: resolveViewports(config.accessibility.viewports, defs),
  };
}

export function parseAbTestsConfig(raw: unknown): AbTestsConfig {
  // Zod strips unknown keys silently; the old name would otherwise quietly
  // fall back to the 0.1 default. Fail loudly instead.
  const rawVisreg = (raw as { visreg?: Record<string, unknown> } | null | undefined)?.visreg;
  if (rawVisreg && 'defaultMisMatchThreshold' in rawVisreg) {
    throw new Error(
      'visreg.defaultMisMatchThreshold was renamed — use visreg.mismatchThreshold ' +
      '(see BREAKING_CHANGES.md).',
    );
  }
  if (rawVisreg && 'requireSameDimensions' in rawVisreg) {
    throw new Error(
      'visreg.requireSameDimensions was removed — a dimension change always fails ' +
      'the compare now (a resize IS a visual difference). Delete the key ' +
      '(see BREAKING_CHANGES.md).',
    );
  }
  // engineOptions was renamed and moved: the base launch options live on
  // shared.playwrightOptions; visreg/perf may override per-category.
  for (const section of ['shared', 'visreg', 'perf', 'accessibility', 'audit'] as const) {
    const rawSection = (raw as Record<string, Record<string, unknown>> | null | undefined)?.[section];
    if (rawSection && 'engineOptions' in rawSection) {
      throw new Error(
        `${section}.engineOptions was renamed — set shared.playwrightOptions` +
        (section === 'visreg' || section === 'perf'
          ? ` (or override per-category via ${section}.playwrightOptions)`
          : '') +
        ' (see BREAKING_CHANGES.md).',
      );
    }
    // Only visreg/perf have a category override; on accessibility/audit the
    // key would be zod-stripped and silently ignored — the natural wrong
    // guess after the engineOptions rename. Fail loudly instead.
    if (
      (section === 'accessibility' || section === 'audit') &&
      rawSection && 'playwrightOptions' in rawSection
    ) {
      throw new Error(
        `${section}.playwrightOptions is not supported — ${section} has no ` +
        'category override; set shared.playwrightOptions (see BREAKING_CHANGES.md).',
      );
    }
  }
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
  return {
    shared: parsed.shared,
    visreg: parsed.visreg,
    perf: parsed.perf,
    audit: parsed.audit,
    accessibility: parsed.accessibility,
    twinServers: parsed.twinServers,
    bisect: parsed.bisect,
  };
}
