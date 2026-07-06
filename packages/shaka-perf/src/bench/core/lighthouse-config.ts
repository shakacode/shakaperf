/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export interface Marker {
  start?: string;
  end: string;
  label: string;
}

export const DEFAULT_MARKERS: Marker[] = [
  { label: 'hydration', start: 'hydration-start', end: 'hydration-end' },
  { label: 'hydration-start', end: 'hydration-start' },
];

export const SCREENCAST_FILENAME = 'screencast.mp4';
export const SCREENCAST_START_FILENAME = 'screencast_start.json';
export const DEFAULT_THROTTLE_PROFILE_LABEL = 'Slow-4G';

import type { Flags } from 'lighthouse/types/externs.js';
import type { Viewport } from 'shaka-shared';

export type LighthouseConfig = Flags;

/**
 * Default for Lighthouse's `maxWaitForLoad` flag — the cap on its
 * "wait until the page is fully loaded" gather phase, in ms. Carried by
 * `DEFAULT_LH_CONFIG` as the fallback when a user's `lighthouseConfig` doesn't
 * set `maxWaitForLoad`. Mirrors Lighthouse's own 45 s default.
 */
export const DEFAULT_MAX_WAIT_FOR_LOAD_MS = 45_000;

/**
 * Lighthouse config minus the fields shaka-perf lowers from `Viewport`:
 * `formFactor` / `screenEmulation` are derived in `lhConfigForViewport`, so
 * stripping them here makes TypeScript flag any attempt to set them via
 * `lighthouseConfig`. Users must have their `abtests.config.ts` included in
 * their tsconfig for this check to fire (IDE per-file checking works
 * regardless).
 *
 * Everything else is a raw Lighthouse flag the user can pass through
 * `lighthouseConfig` — notably `maxWaitForLoad` (the page-load wait cap),
 * which `DEFAULT_LH_CONFIG` defaults and a user value overrides.
 */
export type PerfLighthouseConfig = Omit<LighthouseConfig, 'formFactor' | 'screenEmulation'>;

export const DEFAULT_LH_CONFIG: PerfLighthouseConfig = {
  // Lighthouse "Slow 4G" mobile preset (the profile PSI uses) - realistic, vs
  // the old inflated 700/300/cpu20 default. Under 'simulate' only rttMs +
  // throughputKbps drive Lantern. Override per-project via `lighthouseConfig`,
  // or cpuSlowdownMultiplier for one run via SHAKAPERF_CPU_MULTIPLIER.
  throttling: {
    rttMs: 150,
    throughputKbps: 1638.4,
    requestLatencyMs: 562.5,
    downloadThroughputKbps: 1474.56,
    uploadThroughputKbps: 675,
    cpuSlowdownMultiplier: 4,
  },
  throttlingMethod: "simulate",
  logLevel: 'error',
  output: 'html',
  onlyCategories: ['performance'],
  // Fallback cap on Lighthouse's "page fully loaded" wait. A user's
  // `lighthouseConfig.maxWaitForLoad` overrides this (layered on top in the
  // bench worker); this is what applies when they don't set it.
  maxWaitForLoad: DEFAULT_MAX_WAIT_FOR_LOAD_MS,
};

/**
 * Builds the viewport-specific Lighthouse overlay written to the temp file
 * consumed by the bench worker: user overrides (from `perf.lighthouseConfig`,
 * which can't carry viewport options by type) plus the viewport's
 * `formFactor` / `screenEmulation` on top.
 *
 * `DEFAULT_LH_CONFIG` is intentionally NOT spread in here; the Lighthouse
 * worker layers those defaults under the loaded user config.
 *
 * `maxWaitForLoad` rides through `userOverrides` when the user sets it in
 * `lighthouseConfig`; otherwise `DEFAULT_LH_CONFIG` supplies the fallback.
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

export interface LighthouseReportMeta {
  throttleProfile?: string;
  viewport?: { width: number; height: number };
}

export function reportMetaForLighthouseRun(
  viewport: Viewport | undefined,
  userOverrides: PerfLighthouseConfig = {},
): LighthouseReportMeta {
  const activeConfig = viewport ? lhConfigForViewport(viewport, userOverrides) : userOverrides;
  const screen = (activeConfig as Partial<LighthouseConfig>).screenEmulation;
  const width = typeof screen?.width === 'number' ? screen.width : undefined;
  const height = typeof screen?.height === 'number' ? screen.height : undefined;
  const throttleProfile = throttleProfileForLighthouseConfig(userOverrides);
  return {
    ...(throttleProfile ? { throttleProfile } : {}),
    ...(width !== undefined && height !== undefined ? { viewport: { width, height } } : {}),
  };
}

const SLOW_4G_METHODS = new Set<unknown>(['simulate', 'devtools', undefined]);
const SLOW_4G_THROTTLING_FIELDS = [
  'rttMs',
  'throughputKbps',
  'requestLatencyMs',
  'downloadThroughputKbps',
  'uploadThroughputKbps',
  'cpuSlowdownMultiplier',
] as const;

function throttleProfileForLighthouseConfig(userOverrides: PerfLighthouseConfig): string | undefined {
  const method = userOverrides.throttlingMethod ?? DEFAULT_LH_CONFIG.throttlingMethod;
  if (!SLOW_4G_METHODS.has(method)) return undefined;
  const throttling = effectiveThrottlingForMeta(userOverrides);
  const defaultThrottling = DEFAULT_LH_CONFIG.throttling as Record<string, unknown>;
  const matchesSlow4G = SLOW_4G_THROTTLING_FIELDS.every((field) => (
    throttling[field] === defaultThrottling[field]
  ));
  return matchesSlow4G ? DEFAULT_THROTTLE_PROFILE_LABEL : undefined;
}

function effectiveThrottlingForMeta(userOverrides: PerfLighthouseConfig): Record<string, unknown> {
  if (userOverrides.throttling !== undefined) {
    return userOverrides.throttling as Record<string, unknown>;
  }
  return DEFAULT_LH_CONFIG.throttling as Record<string, unknown>;
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
  /**
   * Resolved Lighthouse config for this viewport. Kept mandatory so worker
   * setup cannot accidentally fall back to default mobile settings.
   */
  lhConfig: LighthouseConfig;
  resultsFolder?: string;
  markers?: Marker[];
  /**
   * Fully resolved URL the Lighthouse worker should navigate for this side.
   * Group/path resolution belongs to the pipeline before the worker boundary.
   */
  targetUrl: string;
  saveArtifacts?: boolean;
  /**
   * Launch Chrome headed (visible window) instead of headless. Off by default;
   * driven by the `--headed` CLI flag. Forwarded to the forked worker via the
   * `SHAKA_PERF_HEADED` env var, which `setupBrowser` reads to drop `--headless`.
   */
  headed?: boolean;
  /**
   * Forwarded to the user's `testFn` so tests can vary behaviour between
   * control and experiment without the worker knowing about groups. The
   * parent sets this from the benchmark's `group`.
   */
  isControl?: boolean;
  /**
   * Enable per-test instrumentation used by the audit's frame-strip view:
   * the interaction recorder (which makes `page.fill` type real keystrokes
   * to surface in the trace) and the side-channel `captureScreenshot`
   * loop that writes `screencast.mp4`. Both add wall-clock cost
   * — the recorder gates per-char typing, the screencast adds ~6–7 frames
   * of work per second — so `compare` (perf bench) leaves this off to
   * preserve measurement fidelity. Audit opts in.
   */
  captureAuditArtifacts?: boolean;
  /**
   * After the user's `testFn` resolves but before the browser is closed,
   * read `window.__coverage__` (populated by babel-plugin-istanbul on the
   * served bundles) and dump it to `${resultsFolder}/coverage.json`. The
   * audit pipeline then aggregates these per-test files into a single
   * Istanbul/nyc HTML report. No-op if the bundles weren't built with
   * istanbul instrumentation — `__coverage__` simply doesn't exist.
   */
  captureCoverage?: boolean;
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
  // Lighthouse accessibility score (0-100); set on audit samples, undefined on
  // compare. A dedicated field, not a perf phase, so perf metrics stay untouched.
  accessibilityScore?: number;
}

// Build a worker NavigationSample, omitting accessibilityScore only when absent
// (null) so a real worst-case 0 still rides through.
export function makeNavigationSample(
  phases: PhaseSample[],
  accessibilityScore: number | null,
): NavigationSample {
  return {
    metadata: {},
    duration: 0,
    phases,
    ...(accessibilityScore != null ? { accessibilityScore } : {}),
  };
}
