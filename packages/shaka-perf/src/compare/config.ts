import * as os from 'node:os';
import { z } from 'zod';
import { AxeGlobalConfigSchema } from 'shaka-accessibility';
import { TwinServersConfigSchema } from '../twin-servers/types';

const DEFAULT_PERF_PARALLELISM = Math.max(1, Math.floor(os.cpus().length / 2));

const ViewportSchema = z.object({
  label: z.string(),
  name: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

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
    viewports: z.array(ViewportSchema).default([
      { label: 'phone', width: 375, height: 667 },
      { label: 'tablet', width: 768, height: 1024 },
      { label: 'desktop', width: 1280, height: 800 },
    ]),
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
    lhConfigPath: z.string().optional(),
    lighthouseConfig: z.record(z.unknown()).optional(),
    plotTitle: z.string().optional(),
  });

export const AbTestsConfigSchema = z.object({
  shared: SharedConfigSchema.optional().default({}),
  visreg: VisregConfigSchema.optional().default({}),
  perf: PerfConfigSchema.optional().default({}),
  // Re-exported from shaka-accessibility so the `axe` block in
  // `abtests.config.ts` parses once and is consumed by both the standalone
  // `shaka-perf axe` command and `shaka-perf compare --categories axe`.
  axe: AxeGlobalConfigSchema.optional().default({}),
  twinServers: TwinServersConfigSchema.optional(),
});

export type AbTestsConfigInput = z.input<typeof AbTestsConfigSchema>;
export type AbTestsConfig = z.infer<typeof AbTestsConfigSchema>;

export type SharedConfig = z.infer<typeof SharedConfigSchema>;
export type VisregConfig = z.infer<typeof VisregConfigSchema>;
export type PerfConfig = z.infer<typeof PerfConfigSchema>;
export type AxeConfig = z.infer<typeof AxeGlobalConfigSchema>;

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
