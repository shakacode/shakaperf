/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/** Where in the app's own source a rendered element was written. */
export interface SourceLocation {
  /** Build-relative, e.g. `app/javascript/consumer/Nav.tsx`: no `./`, scheme, loader, or query. */
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based. Omitted when the build's source map carries no column detail. */
  column?: number;
}

export interface SourceResolveContext {
  /** URL of the page the elements came from. */
  pageUrl: string;
  /** Fetches through the audited browser's network context; null on any failure. */
  fetchText(url: string): Promise<string | null>;
  /** Why elements went unlocated; printed and written into the map header. */
  warn(message: string): void;
}

/**
 * `config.audit.screenshotCoveragePlugin`: names the source location of
 * each element in a visibility map. Two halves, because the evidence lives in
 * the page and the means to read it (source maps) live in Node.
 *
 * `Raw` is what `locate` hands to `resolve`. The config holds the erased
 * `ScreenshotCoveragePlugin` (`Raw = unknown`); a plugin typed over its own
 * `Raw` assigns to it directly because the two are declared as methods, whose
 * parameters are checked bivariantly.
 */
export interface ScreenshotCoveragePlugin<Raw = unknown> {
  /** Named in the visibility-map header. */
  name: string;
  /**
   * Runs IN THE PAGE, once per element, carried there by
   * `Function.prototype.toString` — so no imports or closures, and the result
   * must survive a JSON round trip. Returns what `resolve` needs; null when none.
   */
  locate(element: Element): Raw;
  /**
   * Runs in Node over one page's `locate` results; returns the same length
   * and order, null where no source could be named.
   */
  resolve(
    raws: readonly Raw[],
    context: SourceResolveContext,
  ): Promise<readonly (SourceLocation | null)[]>;
}

/** The plugins shaka-perf ships; a config may name one instead of passing an object. */
export const BUILT_IN_SCREENSHOT_COVERAGE_PLUGINS = ['react18', 'react19'] as const;
export type BuiltInScreenshotCoveragePlugin = (typeof BUILT_IN_SCREENSHOT_COVERAGE_PLUGINS)[number];

export function isBuiltInScreenshotCoveragePlugin(value: unknown): value is BuiltInScreenshotCoveragePlugin {
  return (BUILT_IN_SCREENSHOT_COVERAGE_PLUGINS as readonly unknown[]).includes(value);
}

export function isScreenshotCoveragePlugin(value: unknown): value is ScreenshotCoveragePlugin {
  if (!value || typeof value !== 'object') return false;
  const plugin = value as Partial<ScreenshotCoveragePlugin>;
  return typeof plugin.name === 'string'
    && plugin.name.length > 0
    && typeof plugin.locate === 'function'
    && typeof plugin.resolve === 'function';
}

/** What `resolve` promised per element, checked because it is user code. */
export function isSourceLocation(value: unknown): value is SourceLocation {
  if (!value || typeof value !== 'object') return false;
  const location = value as Partial<SourceLocation>;
  return typeof location.path === 'string'
    && typeof location.line === 'number'
    && (location.column === undefined || typeof location.column === 'number');
}
