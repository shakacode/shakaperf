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

const DEFAULT_PERF_PARALLELISM = Math.max(1, Math.floor(os.cpus().length / 2));

export const ViewportSchema: z.ZodType<Viewport> = z.object({
  label: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  formFactor: z.enum(['mobile', 'desktop']),
  deviceScaleFactor: z.number().positive(),
});

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
  });

export const VisregConfigSchema = z
  .object({
    // Tuple cast so `nonempty().default(...)` type-checks — Zod's non-empty
    // array contract is a `[T, ...T[]]` shape.
    viewports: z.array(ViewportSchema).nonempty().default([
      DESKTOP_VIEWPORT,
      TABLET_VIEWPORT,
      PHONE_VIEWPORT,
    ] as [Viewport, ...Viewport[]]),
    defaultMisMatchThreshold: z.number().nonnegative().default(0.1),
    compareRetries: z.number().int().nonnegative().default(2),
    compareRetryDelay: z.number().int().nonnegative().default(500),
    maxNumDiffPixels: z.number().int().nonnegative().default(50),
    comparePixelmatchThreshold: z.number().nonnegative().default(0.1),
    asyncCaptureLimit: z.number().int().positive().default(2),
    asyncCompareLimit: z.number().int().positive().default(4),
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
    parallelism: z.number().int().positive().default(DEFAULT_PERF_PARALLELISM),
    sampleTimeoutMs: z.number().int().positive().default(120000),
    /**
     * Viewports measured for every perf test. The sole source of
     * truth for Lighthouse's `formFactor` / `screenEmulation` — those
     * fields in `lighthouseConfig` would be overwritten by the per-
     * viewport overlay, so don't bother setting them there. Default
     * measures desktop + phone so device-specific regressions are not
     * missed.
     *
     * Per-test override available via `abTest(…, { options: { perf: {
     * viewports: [...] } } }, …)`.
     */
    viewports: z.array(ViewportSchema).nonempty().default([
      DESKTOP_VIEWPORT,
      PHONE_VIEWPORT,
    ] as [Viewport, ...Viewport[]]),
    // Runtime is a loose record; the TS type narrows it to
    // `PerfLighthouseConfig` so `formFactor` / `screenEmulation` can't be
    // set here — viewports own those, and a compile error beats a runtime
    // surprise.
    lighthouseConfig: z
      .record(z.unknown())
      .optional() as z.ZodType<PerfLighthouseConfig | undefined>,
    plotTitle: z.string().optional(),
  });

export const AbTestsConfigSchema = z.object({
  shared: SharedConfigSchema.optional().default({}),
  visreg: VisregConfigSchema.optional().default({}),
  perf: PerfConfigSchema.optional().default({}),
  twinServers: TwinServersConfigSchema.optional(),
});

export type AbTestsConfigInput = z.input<typeof AbTestsConfigSchema>;
export type AbTestsConfig = z.infer<typeof AbTestsConfigSchema>;

export type SharedConfig = z.infer<typeof SharedConfigSchema>;
export type VisregConfig = z.infer<typeof VisregConfigSchema>;
export type PerfConfig = z.infer<typeof PerfConfigSchema>;

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
  return result.data;
}
