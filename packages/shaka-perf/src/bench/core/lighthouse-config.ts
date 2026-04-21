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
