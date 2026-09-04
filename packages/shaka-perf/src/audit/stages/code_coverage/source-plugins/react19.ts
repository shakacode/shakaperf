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
import { SourceMapLookup } from './source-map-lookup';
import { parseStackFrame } from './stack-frames';

/**
 * The built-in `'react19'` plugin. A React >= 19.1 DEVELOPMENT build keeps
 * `fiber._debugStack`, an Error captured where the element was created, whose
 * frames point into the bundle; its source map turns them into app source
 * lines, as React DevTools does. Production builds carry no `_debugStack` and
 * locate nothing.
 */

export interface React19SourcePluginOptions {
  /**
   * Which resolved source paths count as the app's own code; frames elsewhere
   * are walked past. Default: anything not under `node_modules/` or `.yarn/`
   * and not bundler-internal.
   */
  isAppSource?: (path: string) => boolean;
}

// What `locate` returns for fibers without a debug stack. The page half is
// serialized by source text, so it repeats the literal instead of referencing this.
const NO_DEBUG_STACK = 'react19:no-debug-stack';

// Runs in the page via `Function.prototype.toString`: no imports, no closures.
// Stack line 0 is the message, 1 React's jsx() frame, 2 the JSX call site; a
// couple more are kept in case a wrapper sits between. Owners are walked so
// DOM a library painted resolves to the app component that used it — MUI
// nests several styled layers per element, hence the depth.
function locateReactElement(element: Element): unknown {
  const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
  if (!fiberKey) return null;
  type DebugFiber = {
    _debugStack?: { stack?: unknown } | null;
    _debugOwner?: DebugFiber | null;
  };
  let fiber = (element as unknown as Record<string, DebugFiber | undefined>)[fiberKey];
  const frames: string[] = [];
  let sawStack = false;
  for (let hop = 0; fiber && hop < 12; hop += 1) {
    const stack = fiber._debugStack ? fiber._debugStack.stack : undefined;
    if (typeof stack === 'string') {
      sawStack = true;
      frames.push(...stack.split('\n').slice(1, 5));
    }
    fiber = fiber._debugOwner || undefined;
  }
  return sawStack ? frames : 'react19:no-debug-stack';
}

/** `webpack://demo/./app/javascript/Nav.tsx?1234` → `app/javascript/Nav.tsx`. */
export function normalizeSourcePath(source: string): string {
  let path = source;
  const bang = path.lastIndexOf('!');
  if (bang !== -1) path = path.slice(bang + 1);
  path = path.replace(/^webpack:\/\/[^/]*\//, '').replace(/[?#].*$/, '');
  while (path.startsWith('./')) path = path.slice(2);
  return path;
}

export function isAppSourceByDefault(path: string): boolean {
  return path !== ''
    && !/(^|\/)node_modules\//.test(path)
    && !/(^|\/)\.yarn\//.test(path)
    && !/^\(?(webpack|rspack)\)?[/:]/.test(path)
    && !path.startsWith('external ');
}

export function react19ScreenshotCoveragePlugin(
  options: React19SourcePluginOptions = {},
): ScreenshotCoveragePlugin {
  const isAppSource = options.isAppSource ?? isAppSourceByDefault;
  // Source maps are cached per bundle URL for the life of the plugin (one run).
  const lookups = new Map<string, Promise<SourceMapLookup | null>>();
  return {
    name: 'react19',
    locate: locateReactElement,
    resolve: (raws, context) => resolveFrames(raws, context, isAppSource, lookups),
  };
}

async function resolveFrames(
  raws: readonly unknown[],
  context: SourceResolveContext,
  isAppSource: (path: string) => boolean,
  lookups: Map<string, Promise<SourceMapLookup | null>>,
): Promise<(SourceLocation | null)[]> {
  const unmapped = new Set<string>();
  const lookupFor = (url: string): Promise<SourceMapLookup | null> => {
    let pending = lookups.get(url);
    if (!pending) {
      pending = loadSourceMap(url, context.fetchText);
      lookups.set(url, pending);
    }
    return pending;
  };
  const firstAppFrame = async (frames: unknown[]): Promise<SourceLocation | null> => {
    for (const text of frames) {
      const frame = typeof text === 'string' ? parseStackFrame(text) : null;
      if (!frame || !/^https?:\/\//.test(frame.url)) continue;
      const lookup = await lookupFor(frame.url);
      if (!lookup) {
        unmapped.add(frame.url);
        continue;
      }
      const position = lookup.originalPositionFor(frame.line, frame.column - 1);
      if (!position) continue;
      const path = normalizeSourcePath(position.source);
      if (!isAppSource(path)) continue;
      return {
        path,
        line: position.line,
        // A `cheap-*` map reports column 0 everywhere; don't claim precision it lacks.
        ...(position.column > 0 ? { column: position.column + 1 } : {}),
      };
    }
    return null;
  };

  const locations: (SourceLocation | null)[] = [];
  for (const raw of raws) locations.push(Array.isArray(raw) ? await firstAppFrame(raw) : null);

  const withoutStack = raws.filter((raw) => raw === NO_DEBUG_STACK).length;
  const reactElements = withoutStack + raws.filter(Array.isArray).length;
  const located = locations.filter(Boolean).length;
  if (reactElements === 0) {
    context.warn('no React fibers on this page (no element carries a __reactFiber$ property): nothing for react19 to read');
  } else if (located === 0 && withoutStack > 0) {
    context.warn(
      `${withoutStack} React element(s) carry no owner stack (fiber._debugStack): this is a ` +
      'production React build, or React older than 19.1. Serve a DEVELOPMENT build to locate elements.',
    );
  }
  if (unmapped.size > 0) {
    const urls = [...unmapped];
    context.warn(
      `no usable source map for ${urls.slice(0, 3).join(', ')}` +
      `${urls.length > 3 ? ` and ${urls.length - 3} more` : ''}: build with devtool 'source-map' or ` +
      "'cheap-module-source-map' (an eval-* devtool cannot be fetched)",
    );
  }
  return locations;
}

async function loadSourceMap(
  scriptUrl: string,
  fetchText: SourceResolveContext['fetchText'],
): Promise<SourceMapLookup | null> {
  const script = await fetchText(scriptUrl);
  if (script === null) return null;
  // The bundle's own comment is the last one; an inlined module may carry its own.
  const reference = [...script.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/gm)].at(-1)?.[1];
  if (!reference) return null;
  try {
    const json = reference.startsWith('data:')
      ? decodeDataUrl(reference)
      : await fetchText(new URL(reference, scriptUrl).href);
    return json === null ? null : SourceMapLookup.parse(json);
  } catch {
    return null;
  }
}

function decodeDataUrl(url: string): string | null {
  const comma = url.indexOf(',');
  if (comma === -1) return null;
  const header = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  return /;base64$/i.test(header)
    ? Buffer.from(payload, 'base64').toString('utf8')
    : decodeURIComponent(payload);
}
