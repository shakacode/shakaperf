export interface Marker {
  start?: string;
  end: string;
  label: string;
  isEarlyPhase?: boolean;
}

export const DEFAULT_MARKERS: Marker[] = [
  { label: 'hydration', start: 'hydration-start', end: 'hydration-end' },
  { label: 'hydration-start', end: 'hydration-start', isEarlyPhase: true },
];

import type { Flags } from 'lighthouse/types/externs.js';
import type { Viewport } from 'shaka-shared';

export type LighthouseConfig = Flags;

/**
 * Lighthouse config minus the viewport-owning fields. `Viewport` is the
 * single source of truth for `formFactor` / `screenEmulation` (lowered
 * via `lhConfigForViewport`); stripping them here means TypeScript
 * flags any attempt to set them in `lighthouseConfig`. Users must have
 * their `abtests.config.ts` included in their tsconfig for this check
 * to fire (IDE per-file checking works regardless).
 */
export type PerfLighthouseConfig = Omit<LighthouseConfig, 'formFactor' | 'screenEmulation'>;

export const DEFAULT_LH_CONFIG: PerfLighthouseConfig = {
  throttling: {
    rttMs: 300,
    throughputKbps: 700,
    requestLatencyMs: 1125,
    downloadThroughputKbps: 700,
    uploadThroughputKbps: 700,
    cpuSlowdownMultiplier: 20,
  },
  throttlingMethod: "simulate",
  logLevel: 'error',
  output: 'html',
  onlyCategories: ['performance'],
};

/**
 * Builds the viewport-specific Lighthouse overlay written to the temp file
 * consumed by the bench worker: user overrides (from `perf.lighthouseConfig`,
 * which can't carry viewport options by type) plus the viewport's
 * `formFactor` / `screenEmulation` on top.
 *
 * `DEFAULT_LH_CONFIG` is intentionally NOT spread in here —
 * `create-lighthouse-benchmark-in-process.ts` already layers those defaults
 * under the loaded user config, so repeating them at the bridge layer would
 * be dead work.
 */
export function lhConfigForViewport(
  viewport: Viewport,
  userOverrides: PerfLighthouseConfig = {},
): LighthouseConfig {
  return {
    ...userOverrides,
    formFactor: viewport.formFactor,
    screenEmulation: {
      mobile: viewport.formFactor === 'mobile',
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      disabled: false,
    },
  };
}

export function getCpuSlowdownMultiplier(lhSettings: LighthouseConfig): number {
  return lhSettings.throttlingMethod === 'simulate'
    ? (lhSettings.throttling?.cpuSlowdownMultiplier ?? 1)
    : 1;
}

export interface LighthouseBenchmarkOptions {
  /**
   * Viewport being measured. Sole source of truth for the sampler's
   * `TestFnContext.viewport`; Lighthouse's `formFactor` / `screenEmulation`
   * are lowered from this via `lhConfigForViewport` at the bridge layer.
   * Required — every call site knows which viewport it's driving.
   */
  viewport: Viewport;
  resultsFolder?: string;
  lhConfigPath?: string;
  markers?: Marker[];
  /**
   * Absolute path to a file that should receive every line the worker prints
   * to stdout/stderr during setup + sampling. Parent console output is
   * unchanged; this captures a copy for artifact inspection (and, on failure,
   * for the report's "view logs" surface). Each line is prefixed with the
   * group name so control/experiment interleaves are untangled.
   */
  logFile?: string;
  /**
   * Number of additional attempts (beyond the first) the sampler makes when
   * a Lighthouse run throws — browser crashes, CDP timeouts, etc. The
   * browser is killed and re-launched between tries, with `retryDelay` ms
   * between them. Default 2.
   */
  retries?: number;
  retryDelay?: number;
}

export interface PhaseSample {
  phase: string;
  start: number;
  duration: number;
  sign: 1 | -1;
  unit: string;
}

export interface NavigationSample {
  duration: number;
  phases: PhaseSample[];
  metadata: Record<string, unknown>;
}
