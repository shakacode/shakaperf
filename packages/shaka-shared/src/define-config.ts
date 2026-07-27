/*
 * Copyright (c) 2026 ShakaCode LLC.
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

/**
 * Browser-launch options, one shape for every stage. REQUIRED on
 * `shared.playwrightOptions` — no hidden launch defaults; what the config
 * says is what every stage launches with. `visreg.playwrightOptions` and
 * `perf.playwrightOptions` may override it per-category with a partial of
 * this shape, merged per-key over shared.
 *
 * `waitTimeout` (ms) is respected identically by every Playwright engine
 * (visreg, accessibility, agent-readiness): the default action + navigation
 * timeout. Defaults to 60_000. The perf/audit Lighthouse page-load wait is a
 * different concern, configured via `lighthouseConfig.maxWaitForLoad`.
 *
 * `ignoreHTTPSErrors` defaults to true on every engine (Playwright context
 * option / Lighthouse `--ignore-certificate-errors`); set `false` for strict
 * certificate checking everywhere.
 */
export interface PlaywrightOptionsInput {
  browser: 'chromium' | 'firefox' | 'webkit';
  args?: string[];
  headless?: boolean;
  waitTimeout?: number;
  ignoreHTTPSErrors?: boolean;
  [key: string]: unknown;
}

export interface ResembleOutputOptionsInput {
  transparency?: number;
  ignoreAntialiasing?: boolean;
  usePreciseMatching?: boolean;
  [key: string]: unknown;
}

export interface BrowserConsoleConfigInput {
  /** Console methods that fail a test, on either side. `[]` disables the check. */
  failOn: ('error' | 'warn')[];
  /**
   * Substrings that silence a message, matched against its text or the URL of
   * the script that logged it. A per-test override REPLACES this list.
   */
  allowList: string[];
}

export interface SharedConfigInput {
  controlURL: string;
  experimentURL: string;
  testPathPattern?: string;
  filter?: string;
  /**
   * Full-definition viewports (label + dimensions + formFactor + DPR) — the
   * registry every viewport LABEL elsewhere must resolve against. Defining a
   * viewport does not run it.
   */
  viewportDefinitions?: [Viewport, ...Viewport[]];
  /**
   * Labels (from `viewportDefinitions`) that every category runs at unless it
   * sets its own `viewports`. Defaults to desktop + phone.
   */
  viewports?: [string, ...string[]];
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

   */
  beforeNavigate?: BeforeNavigateHook;
  /**
   * Browser-launch options every stage respects (see PlaywrightOptionsInput).
   * Required — there are no hidden launch defaults.
   */
  playwrightOptions: PlaywrightOptionsInput;
  /** Required, no defaults — same reasoning as `playwrightOptions`. */
  browserConsole: BrowserConsoleConfigInput;
}

export interface VisregConfigInput {
  viewports?: [string, ...string[]];
  mismatchThreshold?: number;
  maxNumDiffPixels?: number;
  comparePixelmatchThreshold?: number;
  compareRetries?: number;
  compareRetryDelay?: number;
  /** Category override of `shared.playwrightOptions` (partial, per-key). */
  playwrightOptions?: Partial<PlaywrightOptionsInput>;
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
  /**
   * Category override of `shared.playwrightOptions` (partial, per-key).
   * Lighthouse is chromium-only; `args`/`headless` map onto its
   * chrome-launcher flags.
   */
  playwrightOptions?: Partial<PlaywrightOptionsInput>;
}

export interface AuditConfigInput {
  viewports?: [string, ...string[]];
  // Raw Lighthouse flags (see `PerfConfigInput.lighthouseConfig`).
  lighthouseConfig?: Record<string, unknown>;
  limitVideoFramesCount?: number;
}

export interface AccessibilityConfigInput {
  viewports?: [string, ...string[]];
  tags?: string[];
  disableRules?: string[];
  includeRules?: string[];
  failOnViolation?: boolean;
}

export interface AgentReadinessConfigInput {
  /**
   * Opt-in: the agent-readiness (AI-legibility) scan is OFF by default. Set to
   * `true` — ideally per-test, on the specific landing pages where a crawler's
   * cold view actually matters — to run it. It measures each URL anonymously
   * (no cookies/auth, and it never runs your test body), so enabling it on
   * every interaction test just scores their `startingPath` cold. See
   * BREAKING_CHANGES.md.
   */
  enabled?: boolean;
}

export interface SetupCommandInput {
  command: string;
  description: string;
}

export interface BisectRepairCommandInput {
  description: string;
  command: string;
}

export type BisectRepairSelectorInput =
  | { commits: [string, ...string[]] }
  | { from?: string; through: string }
  | { all: true };

export interface BisectRepairConfigInput {
  id: string;
  kind?: 'test-harness' | 'build' | 'data' | 'other';
  purpose: string;
  patch: string;
  appliesTo: BisectRepairSelectorInput;
  prepareCommands?: BisectRepairCommandInput[];
  cleanupCommands?: BisectRepairCommandInput[];
}

export interface BisectConfigInput {
  rebuildContainer?: boolean;
  repairs?: BisectRepairConfigInput[];
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
  agentReadiness?: AgentReadinessConfigInput;
  twinServers?: TwinServersConfigInput;
  bisect?: BisectConfigInput;
}

/**
 * The per-test `config` override on `abTest()`, merged over the file config for
 * that test alone. It mirrors the `abtests.config.ts` section shape (same keys,
 * same types) with every field optional, so a test overrides just what it needs.
 *
 * It exposes every section EXCEPT the two that are inherently run/infra-level and
 * make no sense scoped to a single test: `twinServers` (the Docker A/B servers
 * are one pair for the whole run) and `bisect` (a run-level search). Everything
 * else is fair game; settings the engines resolve once per run (e.g. shared
 * `parallelism`) simply won't vary if overridden, but nothing is off-limits by
 * type — the merge (`applyPerTestConfigOverrides`) applies whatever is set.
 */
export type PerTestConfig = {
  [K in keyof Omit<AbTestsConfigInput, 'twinServers' | 'bisect'>]?: K extends 'shared'
    // `shared.playwrightOptions` is a required, browser-mandatory block at the
    // file level, but a per-test override merges per-key — so here it is a
    // partial like every other override.
    ? Omit<Partial<SharedConfigInput>, 'playwrightOptions' | 'browserConsole'> & {
        playwrightOptions?: Partial<PlaywrightOptionsInput>;
        browserConsole?: Partial<BrowserConsoleConfigInput>;
      }
    : Partial<AbTestsConfigInput[K]>;
};

/**
 * Identity function whose only job is to give the user's config object the
 * `AbTestsConfigInput` type for IDE autocomplete and typo-catching. Runtime
 * validation happens in shaka-perf when the CLI loads the config.
 */
export function defineConfig(config: AbTestsConfigInput): AbTestsConfigInput {
  return config;
}
