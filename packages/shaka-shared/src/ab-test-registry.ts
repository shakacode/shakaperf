/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Page, BrowserContext } from 'playwright-core';

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

export interface AbTestVisregConfig {
  // Selectors to capture (from Scenario)
  selectors?: string[];
  selectorExpansion?: boolean | string;
  hideSelectors?: string[];
  removeSelectors?: string[];

  // Interactions (from Scenario)
  hoverSelector?: string;
  hoverSelectors?: string[];
  clickSelector?: string;
  clickSelectors?: string[];
  scrollToSelector?: string;
  postInteractionWait?: number | string;

  // Comparison thresholds (from Scenario)
  misMatchThreshold?: number;
  requireSameDimensions?: boolean;
  maxNumDiffPixels?: number;
  compareRetries?: number;
  compareRetryDelay?: number;
  comparePixelmatchThreshold?: number;
  useBoundingBoxViewportForSelectors?: boolean;

  // Ready state (from Scenario)
  readyEvent?: string;
  readySelector?: string;
  readyTimeout?: number;
  delay?: number;

  // Cookies
  cookiePath?: string;
}

/**
 * Context handed to a `beforeNavigate` hook. Runs BEFORE the engine navigates,
 * so the page may not exist yet — `context` (the Playwright `BrowserContext`)
 * is always present and is the right surface for pre-nav setup that must cover
 * the first navigation and any subframes: `installRequestBlocking(context, ...)`,
 * `addInitScript`, cookies, extra HTTP headers. Avoid Playwright `route()` for
 * perf request blocking because request interception disables Chromium's HTTP
 * cache. `page` is provided only by engines that have one pre-nav (visreg); it
 * is absent on the Lighthouse path (audit/perf), where Lighthouse owns page
 * creation.
 */
export interface BeforeNavigateContext {
  context: BrowserContext;
  /** Present only when the engine already has a page pre-nav (visreg). */
  page?: Page;
  /** The URL about to be navigated for this side. */
  url: string;
  viewport: Viewport;
  isControl: boolean;
  testType: TestType;
}

export type BeforeNavigateHook = (
  ctx: BeforeNavigateContext,
) => void | Promise<void>;

export interface AbTestAccessibilityConfig {
  tags?: string[];
  disableRules?: string[];
  includeRules?: string[];
  skip?: boolean;
}

export interface AbTestOptions {
  markers?: Marker[];
  resultsFolder?: string;
  visreg?: AbTestVisregConfig;
  accessibility?: AbTestAccessibilityConfig;
  /**
   * Runs before this test's page is navigated, on every engine. Use for
   * per-page pre-nav setup — most commonly aborting third-party resources that
   * never resolve in the sandbox (e.g. `installRequestBlocking(context,
   * ['/recaptcha/'])`), but also cookies, headers, or init scripts. Runs AFTER
   * the global `shared.beforeNavigate` (if any). See `BeforeNavigateContext`.
   */
  beforeNavigate?: BeforeNavigateHook;
  /**
   * Narrows which viewports this test runs at (applies to every category).
   * References labels from `shared.viewports`; the intersection with each
   * category's `viewports` list is what actually executes. If the
   * intersection is empty for a category, the test is skipped there with
   * a visible "skipped by viewport filter" marker on the report card.
   *
   * Example: test dashboards only render usefully at desktop widths —
   * `options: { viewports: ['desktop'] }` skips the phone/tablet passes.
   */
  viewports?: string[];
}

export interface AbTestDefinition {
  name: string;
  startingPath: string;
  /**
   * If set, the experiment side benches/visregs against this path instead
   * of `startingPath`. Use when a route was renamed between control and
   * experiment (e.g. control = `/cart`, experiment = `/basket`). Control
   * always uses `startingPath`.
   */
  experimentPathOverride?: string;
  file: string | null;
  line: number | null;
  options: AbTestOptions;
  testTypes: TestType[] | null;
  testFn: (context: TestFnContext) => Promise<void>;
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
  config: {
    startingPath: string;
    experimentPathOverride?: string;
    testTypes?: TestType[];
    options?: AbTestOptions;
  },
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
    name,
    startingPath: config.startingPath,
    experimentPathOverride: config.experimentPathOverride,
    file,
    line,
    options: config.options ?? {},
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
