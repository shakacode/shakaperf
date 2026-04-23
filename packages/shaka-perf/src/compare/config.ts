import * as os from 'node:os';
import { z } from 'zod';
import type { Viewport } from 'shaka-shared';
import { TwinServersConfigSchema } from '../twin-servers/types';

const DEFAULT_PERF_PARALLELISM = Math.max(1, Math.floor(os.cpus().length / 2));

export const ViewportSchema: z.ZodType<Viewport> = z.object({
  label: z.string(),
  name: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  formFactor: z.enum(['mobile', 'desktop']).optional(),
  deviceScaleFactor: z.number().positive().optional(),
});

export type { Viewport };

// Named viewport singletons so visreg and perf share the exact same device
// dimensions by default — a desktop perf regression reporting "1280×800"
// matches the desktop visreg card captured at the same pixel budget.
export const PHONE_VIEWPORT: Viewport = { label: 'phone', width: 375, height: 667 };
export const TABLET_VIEWPORT: Viewport = { label: 'tablet', width: 768, height: 1024 };
export const DESKTOP_VIEWPORT: Viewport = { label: 'desktop', width: 1280, height: 800 };

// Declared as non-empty tuples so `z.array(...).nonempty().default(...)`
// type-checks — Zod's non-empty array contract is a `[T, ...T[]]` shape.
export const DEFAULT_VISREG_VIEWPORTS: [Viewport, ...Viewport[]] = [
  DESKTOP_VIEWPORT,
  TABLET_VIEWPORT,
  PHONE_VIEWPORT,
];
export const DEFAULT_PERF_VIEWPORTS: [Viewport, ...Viewport[]] = [
  DESKTOP_VIEWPORT,
  PHONE_VIEWPORT,
];

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
    viewports: z.array(ViewportSchema).nonempty().default(DEFAULT_VISREG_VIEWPORTS),
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
     * Viewports measured for every perf test. Each entry drives a separate
     * Lighthouse pass whose screenEmulation (width/height/deviceScaleFactor)
     * and form factor are derived from the viewport. Default measures
     * desktop + phone so device-specific regressions are not missed.
     *
     * Per-test override available via `abTest(…, { options: { perf: {
     * viewports: [...] } } }, …)`.
     */
    viewports: z.array(ViewportSchema).nonempty().default(DEFAULT_PERF_VIEWPORTS),
    lhConfigPath: z.string().optional(),
    lighthouseConfig: z.record(z.unknown()).optional(),
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
