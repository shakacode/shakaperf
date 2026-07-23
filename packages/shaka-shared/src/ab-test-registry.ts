/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Page, BrowserContext } from 'playwright-core';
import type { PerTestConfig } from './define-config';

export interface Marker {
  start?: string;
  end: string;
  label: string;
}

export type FormFactor = 'mobile' | 'desktop';

export interface Viewport {
  label: string;
  width: number;
  height: number;
  /**
   * Drives Lighthouse's `formFactor` and `screenEmulation.mobile` when this
   * viewport feeds a perf run. Visreg ignores this field.
   */
  formFactor: FormFactor;
  /**
   * Device pixel ratio fed to Lighthouse's
   * `screenEmulation.deviceScaleFactor` when this viewport feeds a perf run.
   * Visreg ignores this field.
   */
  deviceScaleFactor: number;
}

// Named singletons so visreg and perf share the exact same device dimensions
// by default — a desktop perf regression reporting "1280×800" matches the
// desktop visreg card captured at the same pixel budget. User configs can
// import these from `shaka-shared` to reference the canonical objects.
export const PHONE_VIEWPORT: Viewport = { label: 'phone', width: 375, height: 667, formFactor: 'mobile', deviceScaleFactor: 3 };
export const TABLET_VIEWPORT: Viewport = { label: 'tablet', width: 768, height: 1024, formFactor: 'mobile', deviceScaleFactor: 3 };
export const DESKTOP_VIEWPORT: Viewport = { label: 'desktop', width: 1280, height: 800, formFactor: 'desktop', deviceScaleFactor: 1 };

// Tall counterparts of the canonical devices. Visreg captures a CSS-selector
// element clipped to its bounding box WITHIN the current viewport and no longer
// resizes the page to fit it, so an element taller than the viewport needs one
// of these added to `config.viewports`. The width matches the base device;
// only the height grows. (formFactor/deviceScaleFactor only feed
// perf/Lighthouse; visreg ignores them.)
export const PHONE_TALL_VIEWPORT: Viewport = { label: 'phone-tall', width: 375, height: 3000, formFactor: 'mobile', deviceScaleFactor: 3 };
export const TABLET_TALL_VIEWPORT: Viewport = { label: 'tablet-tall', width: 768, height: 3000, formFactor: 'mobile', deviceScaleFactor: 3 };
export const DESKTOP_TALL_VIEWPORT: Viewport = { label: 'desktop-tall', width: 1280, height: 3000, formFactor: 'desktop', deviceScaleFactor: 1 };

export type TestType = 'perf' | 'visreg' | 'accessibility' | 'audit';

export interface TestFnContext {
  page: Page;
  browserContext: BrowserContext;
  isControl: boolean;
  scenario: AbTestDefinition;
  viewport: Viewport;
  testType: TestType;
  /**
   * Mark a moment in the test body so it surfaces as a labelled chip on the
   * audit report's timeline strip (above the matching screencast frame).
   *
   * Implementation runs `performance.mark('shaka-perf-annotation: <label>')`
   * in the page context during audit/perf runs — the Lighthouse tracer
   * captures the user-timing event, and `bucketEventsToFrames` lines it up
   * with the nearest screencast frame. The returned promise can be
   * fire-and-forget: any failure (e.g. the page was torn down concurrently)
   * is logged and the only visible effect is the missing chip. Awaiting
   * still matters for ORDERING (annotate then click vs. click then annotate).
   *
   * Under visreg this is a no-op for the timeline (visreg has no trace) but
   * the last label is still tracked for error-message decoration.
   */
  annotate: (label: string) => Promise<void>;
}

/**
 * Context handed to a `beforeNavigate` hook. Runs BEFORE the page is created on
 * every engine, so `context` (the Playwright `BrowserContext`) is the only
 * surface — and the right one for pre-nav setup that must cover the first
 * navigation and any subframes: `installRequestBlocking(context, ...)`,
 * `context.addInitScript(...)`, cookies, extra HTTP headers. Init scripts and
 * routes registered on the context apply to every page it opens next, so no
 * pre-nav page is needed. Avoid Playwright `route()` for perf request blocking
 * because request interception disables Chromium's HTTP cache.
 */
export interface BeforeNavigateContext {
  context: BrowserContext;
  /** The URL about to be navigated for this side. */
  url: string;
  viewport: Viewport;
  isControl: boolean;
  testType: TestType;
}

export type BeforeNavigateHook = (
  ctx: BeforeNavigateContext,
) => void | Promise<void>;

/**
 * The per-test configuration `abTest()` accepts. Test identity and the capture
 * directive (`visregSelectors`) sit flat at the top level; anything the test
 * body can already do (interactions, ready-waits, hide/remove) is dropped — do
 * it in the body. Everything the config file owns (thresholds, viewports, axe
 * rule sets, …) is overridable per-test through `config`, a partial of the
 * same `abtests.config.ts` shape.
 */
export interface AbTestConfig {
  startingPath: string;
  /**
   * If set, the experiment side benches/visregs against this path instead
   * of `startingPath`. Use when a route was renamed between control and
   * experiment (e.g. control = `/cart`, experiment = `/basket`). Control
   * always uses `startingPath`.
   */
  experimentPathOverride?: string;
  /** Which categories run for this test. Omitted = every category. */
  testTypes?: TestType[];
  /** CSS selectors visreg captures. Default: the whole document. */
  visregSelectors?: string[];
  /** Per-test perf phase definitions (`{start,end,label}`). */
  markers?: Marker[];
  /**
   * Per-test override of the universal config, merged over the file config for
   * this test alone — so one test can tighten `visreg.mismatchThreshold`,
   * replace `visreg.viewports`, replace the `accessibility.disableRules` list,
   * or swap the pre-navigation hook via `shared.beforeNavigate`, while every
   * other test keeps the file defaults. A defined array replaces the file's
   * wholesale (no union or intersection). The type accepts every section
   * except run-level ones (see `PerTestConfig`); knobs the engines resolve
   * once per run simply won't vary if overridden.
   */
  config?: PerTestConfig;
}

export interface AbTestDefinition extends Omit<AbTestConfig, 'testTypes'> {
  name: string;
  file: string | null;
  line: number | null;
  testTypes: TestType[] | null;
  testFn: (context: TestFnContext) => Promise<void>;
  /**
   * `--burn <n>` instance number (1-based); set by the runner.
   * Dynamic data is deliberately mixed in the static config to not
   * complicate the code.
   */
  burnIndex?: number;
}

// Store the registry on `globalThis` under a versioned Symbol.for key so that
// when a Node process ends up with more than one physical copy of shaka-shared
// loaded — e.g. a globally-installed shaka-perf running against a project that
// also has its own local shaka-shared resolved by tsx from the test files —
// every instance reads and writes the same array. Without this, each instance
// had its own module-scoped array and test registrations registered against
// one instance were invisible to the other ("No tests registered" with files
// that clearly call abTest()).
const REGISTRY_KEY: unique symbol = Symbol.for('shaka-shared.ab-test-registry.v1') as never;
interface RegistryHolder { tests: AbTestDefinition[] }
function registry(): AbTestDefinition[] {
  const g = globalThis as unknown as Record<symbol, RegistryHolder | undefined>;
  let holder = g[REGISTRY_KEY];
  if (!holder) {
    holder = { tests: [] };
    g[REGISTRY_KEY] = holder;
  }
  return holder.tests;
}

export function abTest(
  name: string,
  config: AbTestConfig,
  testFn: (context: TestFnContext) => Promise<void>
): void {
    // Commas are the delimiter for the `--filter` CLI option, so a name
    // containing one would silently split into pieces and match nothing.
    if (name.includes(',')) {
      throw new Error(
        `abTest name must not contain commas (got ${JSON.stringify(name)}) — ` +
          `commas delimit entries in the --filter CLI option.`,
      );
    }
    // Test files are loaded via tsx (transpile-only, no typecheck), so a
    // pre-flattening `options: {...}` blob would otherwise load fine and every
    // legacy knob (selectors, thresholds, beforeNavigate, ...) would silently
    // no-op — a green suite measuring the wrong thing. Fail loudly instead.
    if ('options' in config) {
      throw new Error(
        `abTest(${JSON.stringify(name)}): the 'options' key was removed — ` +
          `abTest() config is now flat (visregSelectors, markers, config.<category>, ...; ` +
          `beforeNavigate moved to config.shared.beforeNavigate). ` +
          `See BREAKING_CHANGES.md for the per-option migration.`,
      );
    }
    // Same failure mode for a stale top-level beforeNavigate: it would spread
    // onto the definition, nothing reads it, and auth/cookie setup silently
    // stops running — a green suite screenshotting login walls on both sides.
    if ('beforeNavigate' in config) {
      throw new Error(
        `abTest(${JSON.stringify(name)}): top-level 'beforeNavigate' moved to ` +
          `config.shared.beforeNavigate — a hook here would be silently ignored. ` +
          `See BREAKING_CHANGES.md.`,
      );
    }
    // Capture call-site file and line number from the stack trace
    let file: string | null = null;
    let line: number | null = null;
    const stack = new Error().stack;
    if (stack) {
      // Stack frame format: "at abTest (...)" then "at <call-site> (file:line:col)"
      const frames = stack.split('\n');
      // The caller is typically the 3rd frame (0=Error, 1=abTest, 2=caller)
      for (let i = 2; i < frames.length; i++) {
        const match = frames[i].match(/\(?([^()]+):(\d+):\d+\)?$/);
        if (match) {
          file = match[1].replace(/^\s*at\s+/, '');
          line = parseInt(match[2], 10);
          break;
        }
      }
    }

  registry().push({
    ...config,
    name,
    file,
    line,
    testTypes: withMandatoryTestTypes(config.testTypes),
    testFn,
  });
}

// Audit runs for every test, so callers can opt into a subset of other types
// without losing the audit pass. `testTypes: null` already means "run all", so
// we only need to extend explicit lists. Accessibility is deliberately not
// auto-added: it is a first-class category, so `testTypes: ['visreg']` should
// mean visual-only work while omitted testTypes still means every category.
function withMandatoryTestTypes(testTypes: TestType[] | undefined): TestType[] | null {
  if (testTypes == null) return null;
  const out = [...testTypes];
  if (!out.includes('audit')) out.push('audit');
  return out;
}

export function testRunsForType(test: AbTestDefinition, type: TestType): boolean {
  return test.testTypes === null || test.testTypes.includes(type);
}

export function getRegisteredTests(): AbTestDefinition[] {
  return [...registry()];
}

export function clearRegistry(): void {
  registry().length = 0;
}

export function restoreRegistry(previous: AbTestDefinition[]): void {
  const r = registry();
  r.length = 0;
  for (const t of previous) r.push(t);
}
