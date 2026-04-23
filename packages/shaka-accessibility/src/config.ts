import { z } from 'zod';
import type { Viewport } from 'shaka-shared';

const ViewportSchema = z.object({
  label: z.string(),
  name: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const EngineOptionsSchema = z
  .object({
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
    args: z.array(z.string()).optional(),
    headless: z.boolean().optional(),
    waitTimeout: z.number().int().positive().optional(),
    asyncLimit: z.number().int().positive().optional(),
  })
  .passthrough();

export const DEFAULT_AXE_VIEWPORTS: Viewport[] = [
  { label: 'mobile', width: 375, height: 667 },
  { label: 'desktop', width: 1280, height: 800 },
];

export const DEFAULT_AXE_TAGS = ['wcag2a', 'wcag2aa'] as const;

const DEFAULT_ENGINE_OPTIONS = {
  browser: 'chromium' as const,
  args: ['--no-sandbox'],
  asyncLimit: 2,
};

export const AxeGlobalConfigSchema = z
  .object({
    viewports: z.array(ViewportSchema).default([...DEFAULT_AXE_VIEWPORTS]),
    tags: z.array(z.string()).default([...DEFAULT_AXE_TAGS]),
    disableRules: z.array(z.string()).default([]),
    includeRules: z.array(z.string()).optional(),
    engineOptions: EngineOptionsSchema.default(DEFAULT_ENGINE_OPTIONS),
    failOnViolation: z.boolean().default(true),
  });

export const AxePerTestConfigSchema = z
  .object({
    viewports: z.array(ViewportSchema).optional(),
    tags: z.array(z.string()).optional(),
    disableRules: z.array(z.string()).optional(),
    includeRules: z.array(z.string()).optional(),
    skip: z.boolean().optional(),
  });

export type AxeGlobalConfigInput = z.input<typeof AxeGlobalConfigSchema>;
export type AxeGlobalConfig = z.infer<typeof AxeGlobalConfigSchema>;
export type AxePerTestConfigInput = z.input<typeof AxePerTestConfigSchema>;
export type AxePerTestConfig = z.infer<typeof AxePerTestConfigSchema>;
export type AxeEngineOptions = z.infer<typeof EngineOptionsSchema>;

/**
 * The resolved per-test ruleset consumed by the runner. `includeRules === null`
 * means "no allowlist active, run all rules matching `tags` minus `disableRules`".
 */
export interface AxeEffectiveConfig {
  viewports: Viewport[];
  tags: string[];
  disableRules: string[];
  includeRules: string[] | null;
  skip: boolean;
}

export function defineAxeConfig(config: AxeGlobalConfigInput): AxeGlobalConfigInput {
  return config;
}

export function parseAxeGlobalConfig(raw: unknown): AxeGlobalConfig {
  const result = AxeGlobalConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    const first = result.error.errors[0];
    const where = first.path.join('.');
    throw new Error(where ? `axe.${where}: ${first.message}` : first.message);
  }
  return result.data;
}

/**
 * Merge global axe config with the per-test override. See requirement 3.5 for
 * the per-field rules:
 *   - tags:         replace if per-test present (tag sets are semantic wholes)
 *   - disableRules: union + dedup (additive is the common case)
 *   - includeRules: replace if per-test present (allowlists are explicit)
 *   - viewports:    replace if per-test present (matches visreg override pattern)
 *   - skip:         per-test only (no global skip)
 */
export function mergeAxeConfig(
  global: AxeGlobalConfig,
  perTest: AxePerTestConfig | undefined,
): AxeEffectiveConfig {
  const tags = perTest?.tags ?? global.tags;
  const disableRules = dedup([
    ...(global.disableRules ?? []),
    ...(perTest?.disableRules ?? []),
  ]);
  const includeRules = perTest?.includeRules
    ? [...perTest.includeRules]
    : global.includeRules
    ? [...global.includeRules]
    : null;
  const viewports = perTest?.viewports ?? global.viewports;
  const skip = perTest?.skip === true;
  return {
    viewports,
    tags: [...tags],
    disableRules,
    includeRules,
    skip,
  };
}

function dedup<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
