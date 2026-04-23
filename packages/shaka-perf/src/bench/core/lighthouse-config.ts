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
import type { Viewport, FormFactor } from 'shaka-shared';

export type LighthouseConfig = Flags;

export function defineConfig(config: LighthouseConfig): LighthouseConfig {
  return config;
}

export const DEFAULT_LH_CONFIG: LighthouseConfig = {
  formFactor: 'mobile',
  screenEmulation: {
    mobile: true,
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
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
 * Builds a Lighthouse `settings` object for the given viewport. The base is
 * `DEFAULT_LH_CONFIG` so desktop and mobile passes share the same throttling,
 * logging, and category selection — a delta between them reflects the form
 * factor, not the measurement setup. `userOverrides` (from
 * `perf.lighthouseConfig`) is layered on top of defaults but BELOW the
 * viewport-derived `formFactor` and `screenEmulation`, so the per-pass
 * viewport selection always wins for the fields it owns.
 */
export function lhConfigForViewport(
  viewport: Viewport,
  userOverrides: Record<string, unknown> = {},
): LighthouseConfig {
  const formFactor: FormFactor =
    viewport.formFactor ?? (viewport.width >= 1024 ? 'desktop' : 'mobile');
  const deviceScaleFactor =
    viewport.deviceScaleFactor ?? (formFactor === 'mobile' ? 3 : 1);
  return {
    ...DEFAULT_LH_CONFIG,
    ...userOverrides,
    formFactor,
    screenEmulation: {
      mobile: formFactor === 'mobile',
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor,
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
