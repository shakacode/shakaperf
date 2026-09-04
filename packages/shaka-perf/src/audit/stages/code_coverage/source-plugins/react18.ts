/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type {
  ScreenshotCoveragePlugin,
  SourceLocation,
  SourceResolveContext,
} from 'shaka-shared';
import { isAppSourceByDefault, normalizeSourcePath } from './source-paths';

/**
 * The built-in `'react18'` plugin. A React 16–18 DEVELOPMENT build whose JSX
 * went through the source transform (`@babel/preset-react` with
 * `development: true`, or `@babel/plugin-transform-react-jsx-source`) keeps
 * each element's `{ fileName, lineNumber, columnNumber }` on its fiber as
 * `_debugSource` — the original file and line, no source map needed. A
 * production build, or one transpiled without that transform, carries no
 * `_debugSource` and locates nothing. React 19 dropped the field; use `'react19'`.
 */

export interface React18SourcePluginOptions {
  /**
   * Which source paths count as the app's own code; elements written elsewhere
   * are walked past to the app component that rendered them. Default: anything
   * not under `node_modules/` or `.yarn/` and not bundler-internal.
   */
  isAppSource?: (path: string) => boolean;
  /**
   * Prefix to strip from the absolute `fileName` the transform records, so the
   * map carries `app/javascript/Nav.tsx` rather than the build machine's path.
   * Default: the audit's working directory.
   */
  root?: string;
}

// What `locate` returns for fibers without a debug source. The page half is
// serialized by source text, so it repeats the literal instead of referencing this.
const NO_DEBUG_SOURCE = 'react18:no-debug-source';

// Runs in the page via `Function.prototype.toString`: no imports, no closures.
// The element's own source first, then its owners': DOM a library painted has
// no `_debugSource` (libraries ship without the transform), and resolves to
// the app component that used it. Styled/HOC layers can stack, hence the depth.
function locateReact18Element(element: Element): unknown {
  const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
  if (!fiberKey) return null;
  type DebugSource = { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown };
  type DebugFiber = { _debugSource?: DebugSource | null; _debugOwner?: DebugFiber | null };
  let fiber = (element as unknown as Record<string, DebugFiber | undefined>)[fiberKey];
  const sources: Array<{ fileName: string; lineNumber: number; columnNumber?: number }> = [];
  for (let hop = 0; fiber && hop < 12; hop += 1) {
    const source = fiber._debugSource;
    if (source && typeof source.fileName === 'string' && typeof source.lineNumber === 'number') {
      sources.push({
        fileName: source.fileName,
        lineNumber: source.lineNumber,
        ...(typeof source.columnNumber === 'number' ? { columnNumber: source.columnNumber } : {}),
      });
    }
    fiber = fiber._debugOwner || undefined;
  }
  return sources.length > 0 ? sources : 'react18:no-debug-source';
}

export function react18ScreenshotCoveragePlugin(
  options: React18SourcePluginOptions = {},
): ScreenshotCoveragePlugin {
  const isAppSource = options.isAppSource ?? isAppSourceByDefault;
  const root = options.root ?? process.cwd();
  return {
    name: 'react18',
    locate: locateReact18Element,
    resolve: async (raws, context) => resolveSources(raws, context, isAppSource, root),
  };
}

interface RawSource { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown }

function resolveSources(
  raws: readonly unknown[],
  context: SourceResolveContext,
  isAppSource: (path: string) => boolean,
  root: string,
): (SourceLocation | null)[] {
  const firstAppSource = (sources: unknown[]): SourceLocation | null => {
    for (const source of sources as RawSource[]) {
      if (!source || typeof source.fileName !== 'string' || typeof source.lineNumber !== 'number') continue;
      const path = normalizeSourcePath(source.fileName, root);
      if (!isAppSource(path)) continue;
      return {
        path,
        line: source.lineNumber,
        ...(typeof source.columnNumber === 'number' ? { column: source.columnNumber } : {}),
      };
    }
    return null;
  };

  const locations = raws.map((raw) => (Array.isArray(raw) ? firstAppSource(raw) : null));

  const withoutSource = raws.filter((raw) => raw === NO_DEBUG_SOURCE).length;
  const reactElements = withoutSource + raws.filter(Array.isArray).length;
  const located = locations.filter(Boolean).length;
  if (reactElements === 0) {
    context.warn('no React fibers on this page (no element carries a __reactFiber$ property): nothing for react18 to read');
  } else if (located === 0 && withoutSource > 0) {
    context.warn(
      `${withoutSource} React element(s) carry no fiber._debugSource: this is a production build, or a ` +
      'development build transpiled without the JSX source transform (@babel/preset-react `development: true`). ' +
      'React 19 dropped the field — use the react19 plugin there.',
    );
  }
  return locations;
}
