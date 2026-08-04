/*
 * Copyright (c) 2026 ShakaCode LLC.
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
}).strict();

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
 * A non-empty array of viewport LABELS (strings), referencing the full
 * definitions in `shared.viewportDefinitions`. Label-set existence (every label
 * must be defined there) is validated at the root schema level — we can't
 * refine here without cross-schema access.
 */
function viewportLabelList() {
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
    });
}

/**
 * A category's viewport labels. LEFT UNSET on purpose when the user doesn't
 * narrow: the fallback to `shared.viewports` is resolved downstream by
 * `viewportsForCategory`, not baked in here. Materialising a default at parse
 * time would break the per-test override — `applyPerTestConfigOverrides` merges
 * the test's `config` onto the ALREADY-PARSED file config, so a filled-in
 * category default would outrank a per-test `shared.viewports` and silently
 * ignore it.
 */
function categoryViewportLabels() {
  return viewportLabelList().optional();
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

/**
 * A `console.error` / `console.warn` from the page under test fails that test,
 * on either side. Captured from Playwright's context-level `console` event, so
 * only the page's own console API calls count — not failed subresource loads,
 * CSP violations or uncaught exceptions.
 */
export const BrowserConsoleConfigSchema = z
  .object({
    // `[]` disables the check — hence no separate `enabled` flag.
    failOn: z.array(z.enum(['error', 'warn'])),
    // Substrings matched against the message text or the logging script's URL.
    // A per-test override REPLACES this list rather than extending it.
    allowList: z.array(z.string()),
  })
  .strict();

export const SharedConfigSchema = z
  .object({
    controlURL: z.string().url(),
    experimentURL: z.string().url(),
    testPathPattern: z.string().optional(),
    filter: z.string().optional(),
    /**
     * Full-definition viewports (label + dimensions + formFactor + DPR).
     * The registry: every viewport LABEL used anywhere else — `shared.viewports`,
     * `<category>.viewports`, and per-test `config.<category>.viewports` — must
     * resolve to an entry here. Defining a viewport does not run it.
     */
    viewportDefinitions: viewportArray([DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT]),
    /**
     * Labels (from `shared.viewportDefinitions`) that every category runs at
     * unless it sets its own `viewports`. This is the one place to change the
     * breakpoints for a whole run; `visreg.viewports` / `perf.viewports` /
     * `audit.viewports` / `accessibility.viewports` override it per category,
     * and a per-test `config.<category>.viewports` overrides that.
     *
     * A per-test `config.shared.viewports` narrows every category the test
     * runs — but only those the FILE config left unset, since an explicit
     * file-level category list is the more specific of the two.
     */
    viewports: viewportLabelList().default(['desktop', 'phone']),
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
    // Required, no defaults — same reasoning as `playwrightOptions`.
    browserConsole: BrowserConsoleConfigSchema,
  })
  // Strict: an unknown key is a typo or a removed option. Zod's default is to
  // strip silently, which is how a renamed knob quietly falls back to its
  // default — the failure this config surface exists to prevent. Applies to
  // per-test `config` overrides too, since those are validated through this
  // same schema after the merge (see `applyPerTestConfigOverrides`).
  // `playwrightOptions` stays passthrough: extra keys there are forwarded to
  // Playwright's `launch()` on purpose.
  .strict();

export const VisregConfigSchema = z
  .object({
    /**
     * Labels (from `shared.viewportDefinitions`) that visreg runs at. Unset
     * means "whatever `shared.viewports` says"; set it to give visreg its own
     * breakpoints, or replace per-test via `config.visreg.viewports`.
     */
    viewports: categoryViewportLabels(),
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
  })
  .strict();

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
     * Labels (from `shared.viewportDefinitions`) that perf runs at. Unset
     * means "whatever `shared.viewports` says"; set it to give perf its own
     * breakpoints, or replace per-test via `config.perf.viewports`.
     */
    viewports: categoryViewportLabels(),
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
  })
  .strict();

/**
 * Audit-only knobs. Independent from `perf` — set what the audit pipeline
 * should use; if you want them to match your perf settings, copy the values
 * over. No silent inheritance. (Runner-level timeouts live on
 * `shared.timeoutMs` and cover both pipelines.)
 */
export const AuditConfigSchema = z
  .object({
    // Unset means "whatever `shared.viewports` says".
    viewports: categoryViewportLabels(),
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
  })
  .strict();

export const AccessibilityConfigSchema = z
  .object({
    // Unset means "whatever `shared.viewports` says".
    viewports: categoryViewportLabels(),
    // axe tags are category labels, not a hierarchy: `best-practice` does not
    // include WCAG rules, and WCAG AA tags do not include A tags.
    tags: z.array(z.string()).default([...DEFAULT_ACCESSIBILITY_TAGS]),
    disableRules: z.array(z.string()).default([]),
    includeRules: z.array(z.string()).optional(),
    failOnViolation: z.boolean().default(true),
  })
  .strict();

export const AgentReadinessConfigSchema = z
  .object({
    // Opt-in: the AI-legibility scan is OFF unless a test (or the file) turns it
    // on. It measures a URL as an anonymous crawler would — no cookies/auth, and
    // it never runs the test body — so blanket-enabling it on interaction tests
    // just scores their `startingPath` cold. Recommended usage: enable per-test
    // (`config.agentReadiness.enabled`) on the landing pages that matter.
    enabled: z.boolean().default(false),
  })
  .strict();

export const BisectConfigSchema = z.object({
  rebuildContainer: z.boolean().default(false),
}).strict();

export const AbTestsConfigSchema = z
  .object({
    shared: SharedConfigSchema,
    visreg: VisregConfigSchema.optional().default({}),
    perf: PerfConfigSchema.optional().default({}),
    audit: AuditConfigSchema.optional().default({}),
    accessibility: AccessibilityConfigSchema.optional().default({}),
    agentReadiness: AgentReadinessConfigSchema.optional().default({}),
    twinServers: TwinServersConfigSchema.optional(),
    bisect: BisectConfigSchema.optional().default({}),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    // Cross-schema: every viewport label — the shared default list and each
    // category's own — must be defined in `shared.viewportDefinitions`. Catches
    // typos ("dekstop") and wrong references at parse time rather than
    // "no viewport matched" at run time.
    const knownLabels = new Set(cfg.shared.viewportDefinitions.map((v) => v.label));
    const lists: Array<[path: [string, string], labels: readonly string[] | undefined]> = [
      [['shared', 'viewports'], cfg.shared.viewports],
      ...(['visreg', 'perf', 'audit', 'accessibility'] as const)
        .map((category) => [[category, 'viewports'], cfg[category].viewports] as
          [[string, string], readonly string[] | undefined]),
    ];
    for (const [path, labels] of lists) {
      // An unset category list is not an error — it falls back to
      // `shared.viewports`, which this same loop already validated.
      for (const label of labels ?? []) {
        if (!knownLabels.has(label)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message:
              `unknown viewport label "${label}" — ` +
              `define it in shared.viewportDefinitions or drop it here. ` +
              `Known: ${[...knownLabels].join(', ')}`,
          });
        }
      }
    }
  });

// Zod's inferred shape: category viewports are string[]. We resolve these
// into full Viewport[] in `buildAbTestsConfig` so downstream code receives
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
export type AgentReadinessConfig = z.infer<typeof AgentReadinessConfigSchema>;
export type BrowserConsoleConfig = z.infer<typeof BrowserConsoleConfigSchema>;
export type BisectConfig = z.infer<typeof BisectConfigSchema>;

/**
 * Resolve viewport LABELS into their full `Viewport` definitions from
 * `shared.viewportDefinitions`. Throws on a label with no definition — a typo'd
 * per-test override must fail loudly, not silently skip the viewport (file-level
 * labels are already schema-validated, so in practice this catches per-test
 * lists). This is the single point where the label→object indirection is turned
 * back into objects, run by whoever needs dimensions (the runner's expansion,
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
        `Unknown viewport label '${label}' — defined in shared.viewportDefinitions: ` +
        `${[...byLabel.keys()].map((l) => `'${l}'`).join(', ')}.`,
      );
    }
    return v;
  });
}

/**
 * The viewports one stage category runs at, under one (already per-test-merged)
 * config. THE single site of the `<category>.viewports ?? shared.viewports`
 * fallback — every caller that needs a category's viewports goes through here,
 * so the precedence lives in exactly one place:
 *
 *   test `config.<category>.viewports`   (most specific)
 *   file `<category>.viewports`
 *   test `config.shared.viewports`
 *   file `shared.viewports`              (least specific)
 *
 * Test-over-file at each level is the per-test deep merge's doing
 * (`applyPerTestConfigOverrides`); category-over-shared is the `??` below.
 */
export function viewportsForCategory(
  config: AbTestsConfig,
  category: TestType,
): readonly Viewport[] {
  return resolveViewports(
    config[category].viewports ?? config.shared.viewports,
    config.shared.viewportDefinitions,
  );
}

export interface AbTestsConfig {
  shared: SharedConfig;
  visreg: VisregConfig;
  perf: PerfConfig;
  audit: AuditConfig;
  accessibility: AccessibilityConfig;
  agentReadiness: AgentReadinessConfig;
  twinServers?: AbTestsConfigParsed['twinServers'];
  bisect: BisectConfig;
}

/**
 * Build the complete per-stage-category viewport record the runner expects.
 * One source of truth for "which TestType maps to which config section,"
 * so adding a new category (e.g. real `accessibility`) edits only this site.
 */
export function viewportsByStageCategory(
  config: AbTestsConfig,
): Record<TestType, readonly Viewport[]> {
  return {
    visreg: viewportsForCategory(config, 'visreg'),
    perf: viewportsForCategory(config, 'perf'),
    audit: viewportsForCategory(config, 'audit'),
    accessibility: viewportsForCategory(config, 'accessibility'),
  };
}

/**
 * Build a validated `AbTestsConfig` from a raw config object: check it against
 * the schema, apply defaults, and reject anything unrecognized. No text parsing
 * happens here — `loadAbTestsConfig` already turned the file into an object.
 *
 * `origin` labels where the object came from, so a per-test override's error
 * names the test instead of reading like a config-file problem — pass
 * `abTest("Homepage")` for one, omit it for `abtests.config.ts`.
 *
 * Also the validator for per-test `config` overrides: those are merged onto the
 * already-built file config and the RESULT comes back through here
 * (`applyPerTestConfigOverrides`). Validating the merged whole rather than the
 * partial is what makes that work — required fields and defaults are already
 * supplied by the file, so nothing is missing and nothing is re-defaulted (the
 * second pass is idempotent), and the cross-field `superRefine` runs against the
 * config the test will actually execute with.
 */
export function buildAbTestsConfig(raw: unknown, origin?: string): AbTestsConfig {
  const at = origin ? `${origin}: ` : '';
  // No per-key migration guards: every section is `.strict()`, so a removed or
  // misspelled key is rejected by name on its own. Renames are documented in
  // BREAKING_CHANGES.md rather than restated here — one list to maintain, and
  // no risk of a future rename shipping without its guard.
  const result = AbTestsConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    const first = result.error.errors[0];
    const path = first.path.join('.');
    throw new Error(at + (path ? `${path}: ${first.message}` : first.message));
  }
  const parsed = result.data;
  return {
    shared: parsed.shared,
    visreg: parsed.visreg,
    perf: parsed.perf,
    audit: parsed.audit,
    accessibility: parsed.accessibility,
    agentReadiness: parsed.agentReadiness,
    twinServers: parsed.twinServers,
    bisect: parsed.bisect,
  };
}
