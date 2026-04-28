import * as os from 'node:os';
import { z } from 'zod';
import {
  DESKTOP_VIEWPORT,
  PHONE_VIEWPORT,
  TABLET_VIEWPORT,
  type Viewport,
} from 'shaka-shared';
import { TwinServersConfigSchema } from '../twin-servers/types';
import type { PerfLighthouseConfig } from '../bench/core/lighthouse-config';

// Halve the core count so a full compare run (parallel visreg browsers +
// Lighthouse workers) has headroom for the two dockerized app stacks we're
// measuring and any system noise. Users can override via `shared.parallelism`.
const DEFAULT_PARALLELISM = Math.max(1, Math.floor(os.cpus().length / 2));

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
 * (bucket Map keys, `perf-<label>` subdirs, VisregArtifact.viewportLabel,
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

const ResembleOutputOptionsSchema = z
  .object({
    transparency: z.number().optional(),
    ignoreAntialiasing: z.boolean().optional(),
    usePreciseMatching: z.boolean().optional(),
  })
  .passthrough();

export const SharedConfigSchema = z
  .object({
    controlURL: z.string().url().default('http://localhost:3020'),
    experimentURL: z.string().url().default('http://localhost:3030'),
    testPathPattern: z.string().optional(),
    filter: z.string().optional(),
    resultsFolder: z.string().default('compare-results'),
    /**
     * Full-definition viewports (label + dimensions + formFactor + DPR).
     * Single source of truth; `visreg.viewports` and `perf.viewports`
     * reference these by label, and per-test `options.viewports` narrows
     * which labels a given test runs at.
     */
    viewports: viewportArray([DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT]),
    /**
     * Cross-engine concurrency budget. Used for the bench worker pool and
     * for visreg's parallel capture + pixel-compare limits — both engines
     * share a single pool of CPU cores, so exposing one knob lets users
     * tune overall load without juggling engine-specific fields. Defaults
     * to half the core count.
     */
    parallelism: z.number().int().positive().default(DEFAULT_PARALLELISM),
    /**
     * Cross-engine retry policy for transient failures. Perf retries a
     * Lighthouse sample (the Chrome subprocess is recycled between tries);
     * visreg retries a mismatched screenshot-pair comparison. `retries`
     * is the number of additional attempts after the first failure;
     * `retryDelay` is the ms between them.
     */
    retries: z.number().int().nonnegative().default(2),
    retryDelay: z.number().int().nonnegative().default(1000),
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
    samplingMode: z
      .enum(['sequential', 'simultaneous'])
      .default('simultaneous'),
    sampleTimeoutMs: z.number().int().positive().default(120000),
    /**
     * Labels (from `shared.viewports`) that perf runs at. Default is
     * desktop + phone so device-specific regressions aren't missed.
     * Narrow here to skip breakpoints for all tests, or per-test via
     * `options.viewports`.
     */
    viewports: viewportLabelArray(['desktop', 'phone']),
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

export const AbTestsConfigSchema = z
  .object({
    shared: SharedConfigSchema.optional().default({}),
    visreg: VisregConfigSchema.optional().default({}),
    perf: PerfConfigSchema.optional().default({}),
    twinServers: TwinServersConfigSchema.optional(),
  })
  .superRefine((cfg, ctx) => {
    // Cross-schema: every category's viewport label must be defined in
    // `shared.viewports`. Catches typos ("dekstop") and wrong references
    // at parse time rather than "no viewport matched" at run time.
    const knownLabels = new Set(cfg.shared.viewports.map((v) => v.label));
    for (const category of ['visreg', 'perf'] as const) {
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

export type AbTestsConfigInput = z.input<typeof AbTestsConfigSchema>;

export type SharedConfig = z.infer<typeof SharedConfigSchema>;
export type VisregConfig = Omit<z.infer<typeof VisregConfigSchema>, 'viewports'> & {
  viewports: Viewport[];
};
export type PerfConfig = Omit<z.infer<typeof PerfConfigSchema>, 'viewports'> & {
  viewports: Viewport[];
};
export interface AbTestsConfig {
  shared: SharedConfig;
  visreg: VisregConfig;
  perf: PerfConfig;
  twinServers?: AbTestsConfigParsed['twinServers'];
}

export function defineConfig(config: AbTestsConfigInput): AbTestsConfigInput {
  return config;
}

export function parseAbTestsConfig(raw: unknown): AbTestsConfig {
  const result = AbTestsConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    const first = result.error.errors[0];
    const where = first.path.join('.');
    throw new Error(where ? `${where}: ${first.message}` : first.message);
  }
  const parsed = result.data;
  const byLabel = new Map(parsed.shared.viewports.map((v) => [v.label, v]));
  const resolve = (labels: string[]): Viewport[] =>
    labels.map((l) => byLabel.get(l)!); // safe: root superRefine validated membership
  return {
    shared: parsed.shared,
    visreg: { ...parsed.visreg, viewports: resolve(parsed.visreg.viewports) },
    perf: { ...parsed.perf, viewports: resolve(parsed.perf.viewports) },
    twinServers: parsed.twinServers,
  };
}
