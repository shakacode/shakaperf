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
 * `config.codeCoverage.screenshotCoveragePlugin`: names the source location of
 * each element in a visibility map. Two halves, because the evidence lives in
 * the page and the means to read it (source maps) live in Node.
 */
export interface ScreenshotCoveragePlugin {
  /** Named in the visibility-map header. */
  name: string;
  /**
   * Runs IN THE PAGE, once per element, carried there by
   * `Function.prototype.toString` — so no imports or closures. Returns what
   * `resolve` needs, or without `resolve` a `SourceLocation`; null when none.
   */
  locate: (element: Element) => unknown;
  /**
   * Runs in Node over one page's `locate` results; returns the same length
   * and order, null where no source could be named.
   */
  resolve?: (
    raws: readonly unknown[],
    context: SourceResolveContext,
  ) => Promise<readonly (SourceLocation | null)[]>;
}

export function isScreenshotCoveragePlugin(value: unknown): value is ScreenshotCoveragePlugin {
  if (!value || typeof value !== 'object') return false;
  const plugin = value as Partial<ScreenshotCoveragePlugin>;
  return typeof plugin.name === 'string'
    && plugin.name.length > 0
    && typeof plugin.locate === 'function'
    && (plugin.resolve === undefined || typeof plugin.resolve === 'function');
}
