/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Hand-written input shapes for `abtests.config.ts`. Runtime validation
// lives in shaka-perf (Zod schemas in `src/config.ts`); these interfaces
// describe what the *user* writes, so that `defineConfig` can give IDE
// autocomplete without dragging Zod or the engine code into shaka-shared.
//
// Drift risk: when you change a schema in shaka-perf, update the matching
// field here. The schema file's neighbours have a `_checkInput` block that
// fails compilation if the shapes disagree.

import type { BeforeNavigateHook, Viewport } from './ab-test-registry';

export interface EngineOptionsInput {
  browser?: string;
  args?: string[];
  headless?: boolean;
  waitTimeout?: number;
  [key: string]: unknown;
}

export interface ResembleOutputOptionsInput {
  transparency?: number;
  ignoreAntialiasing?: boolean;
  usePreciseMatching?: boolean;
  [key: string]: unknown;
}

export interface SharedConfigInput {
  controlURL: string;
  experimentURL: string;
  testPathPattern?: string;
  filter?: string;
  /** Full-definition viewports (label + dimensions + formFactor + DPR). */
  viewports?: [Viewport, ...Viewport[]];
  parallelism: number;
  retries?: number;
  retryDelay?: number;
  timeoutMs?: number;
  /**
   * Runs before EVERY test's page is navigated, on every engine (visreg,
   * audit, perf). Use for cross-cutting pre-nav setup — most commonly aborting
   * third-party resources that never resolve in the sandboxed twin-servers and
   * would otherwise hang `networkidle` (e.g. Google reCAPTCHA):
   *
   *   beforeNavigate: ({ context }) =>
   *     installRequestBlocking(context, ['/recaptcha/'])
   *
   * A per-test `beforeNavigate` (on `abTest()` options), if present, RECEIVES
   * this hook as a second argument and decides whether to call it — so a test
   * can extend, wrap, or opt out of the global setup. Tests with no per-test
   * hook get this one automatically. See `BeforeNavigateContext`.
   */
  beforeNavigate?: BeforeNavigateHook;
}

export interface VisregConfigInput {
  viewports?: [string, ...string[]];
  defaultMisMatchThreshold?: number;
  maxNumDiffPixels?: number;
  comparePixelmatchThreshold?: number;
  compareRetries?: number;
  compareRetryDelay?: number;
  engineOptions?: EngineOptionsInput;
  resembleOutputOptions?: ResembleOutputOptionsInput;
}

export interface PerfConfigInput {
  numberOfMeasurements?: number;
  regressionThreshold?: number;
  pValueThreshold?: number;
  regressionThresholdStat?: 'estimator' | 'ci-lower' | 'ci-upper';
  samplingMode?: 'sequential' | 'simultaneous';
  viewports?: [string, ...string[]];
  // Raw Lighthouse flags. Set `maxWaitForLoad` (ms) here to cap LH's page-load
  // wait before measuring; the engine layers in `formFactor` / `screenEmulation`.
  lighthouseConfig?: Record<string, unknown>;
  plotTitle?: string;
}

export interface AuditConfigInput {
  viewports?: [string, ...string[]];
  // Raw Lighthouse flags (see `PerfConfigInput.lighthouseConfig`).
  lighthouseConfig?: Record<string, unknown>;
  limitVideoFramesCount?: number;
}

export interface AccessibilityEngineOptionsInput {
  browser?: 'chromium' | 'firefox' | 'webkit';
  args?: string[];
  headless?: boolean;
  waitTimeout?: number;
  [key: string]: unknown;
}

export interface AccessibilityConfigInput {
  viewports?: [string, ...string[]];
  tags?: string[];
  disableRules?: string[];
  includeRules?: string[];
  engineOptions?: AccessibilityEngineOptionsInput;
  failOnViolation?: boolean;
}

export interface SetupCommandInput {
  command: string;
  description: string;
}

export interface BisectConfigInput {
  rebuildContainer?: boolean;
}

export interface CopyIgnoreConfigInput {
  /** Repository-relative directory patterns excluded from change copying. */
  folders?: string[];
  /** Repository-relative file patterns excluded from change copying. */
  files?: string[];
}

export interface TwinServersConfigInput {
  experimentDir: string;
  controlDir: string;
  dockerBuildDir: string;
  dockerfile: string;
  dockerBuildArgs?: Record<string, string>;
  composeFile?: string;
  procfile: string;
  ports: { control: number; experiment: number };
  /**
   * LAST RESORT — most apps need none. Prefer doing all setup (install, build,
   * migrate, seed) in the Dockerfile so the image is self-contained. These run
   * in both containers at start; use them only for what can't be baked into an
   * image, chiefly starting an embedded service daemon.
   */
  setupCommands?: SetupCommandInput[];
  /**
   * Commands run inside the experiment container after its source changes,
   * before the experiment processes restart.
   */
  rebuildCommands?: SetupCommandInput[];
  /**
   * Host-only files and folders excluded from twin-server change copying.
   * Each supplied array overrides its corresponding packaged default list.
   */
  copyIgnore?: CopyIgnoreConfigInput;
}

export interface AbTestsConfigInput {
  shared: SharedConfigInput;
  visreg?: VisregConfigInput;
  perf?: PerfConfigInput;
  audit?: AuditConfigInput;
  accessibility?: AccessibilityConfigInput;
  twinServers?: TwinServersConfigInput;
  bisect?: BisectConfigInput;
}

/**
 * Identity function whose only job is to give the user's config object the
 * `AbTestsConfigInput` type for IDE autocomplete and typo-catching. Runtime
 * validation happens in shaka-perf when the CLI loads the config.
 */
export function defineConfig(config: AbTestsConfigInput): AbTestsConfigInput {
  return config;
}
