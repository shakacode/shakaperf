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
import { isAppSourceByDefault, normalizeSourcePath } from './source-paths';
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

const NO_DEBUG_STACK = 'react19:no-debug-stack';

/**
 * What `locate` hands to `resolve`: the owner-chain stack frames, the marker
 * for a React element without a debug stack, or null for a non-React element.
 */
type Located = readonly string[] | typeof NO_DEBUG_STACK | null;

/** The fields of a React 19 development fiber this plugin reads. */
type DebugFiber = {
  _debugStack?: { stack?: unknown } | null;
  _debugOwner?: DebugFiber | null;
};

// Runs in the page via `Function.prototype.toString`: no imports, no closures
// over runtime values (types are erased, so the annotations cost nothing and
// the return type checks the literal against NO_DEBUG_STACK).
// Stack line 0 is the message, 1 React's jsx() frame, 2 the JSX call site; a
// couple more are kept in case a wrapper sits between. Owners are walked so
// DOM a library painted resolves to the app component that used it — MUI
// nests several styled layers per element, hence the depth.
function locateReactElement(element: Element): Located {
  const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
  if (!fiberKey) return null;
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

/**
 * One bundle's map, or the definite reason it has none. A fetch that failed
 * for a passing reason (timeout, refused connection, a context that closed)
 * is neither: it rejects instead, and is not kept.
 */
type LoadedSourceMap =
  | { lookup: SourceMapLookup; reason?: undefined }
  | { lookup: null; reason: string };

export function react19ScreenshotCoveragePlugin(
  options: React19SourcePluginOptions = {},
): ScreenshotCoveragePlugin {
  const isAppSource = options.isAppSource ?? isAppSourceByDefault;
  // Per bundle URL for the life of the plugin (one run): parsed maps and the
  // definite reasons a bundle has none. A rejected load is evicted, so the
  // next unit fetches again rather than inheriting one unit's bad luck.
  const lookups = new Map<string, Promise<LoadedSourceMap>>();
  return {
    name: 'react19',
    locate: locateReactElement,
    resolve: (raws: readonly Located[], context) => resolveFrames(raws, context, isAppSource, lookups),
  };
}

async function resolveFrames(
  raws: readonly Located[],
  context: SourceResolveContext,
  isAppSource: (path: string) => boolean,
  lookups: Map<string, Promise<LoadedSourceMap>>,
): Promise<(SourceLocation | null)[]> {
  // bundle URL → why it yielded no map this unit
  const unmapped = new Map<string, string>();
  // bundle URL → why its fetch failed this unit; tried once per unit, not per frame
  const failed = new Map<string, string>();
  const lookupFor = (url: string): Promise<LoadedSourceMap> => {
    let pending = lookups.get(url);
    if (!pending) {
      const load = loadSourceMap(url, context.fetchText);
      pending = load;
      lookups.set(url, load);
      load.catch(() => {
        if (lookups.get(url) === load) lookups.delete(url);
      });
    }
    return pending;
  };
  const firstAppFrame = async (frames: readonly string[]): Promise<SourceLocation | null> => {
    for (const text of frames) {
      const frame = parseStackFrame(text);
      if (!frame || !/^https?:\/\//.test(frame.url)) continue;
      if (failed.has(frame.url)) continue;
      let loaded: LoadedSourceMap;
      try {
        loaded = await lookupFor(frame.url);
      } catch (err) {
        failed.set(frame.url, errorMessage(err));
        continue;
      }
      if (!loaded.lookup) {
        unmapped.set(frame.url, loaded.reason);
        continue;
      }
      const position = loaded.lookup.originalPositionFor(frame.line, frame.column - 1);
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
  for (const [reason, urls] of groupByValue(unmapped)) {
    context.warn(`no usable source map for ${listOf(urls)}: ${reason}`);
  }
  for (const [message, urls] of groupByValue(failed)) {
    context.warn(
      `the source map of ${listOf(urls)} could not be fetched this unit (${message}); ` +
      'not cached, tried again on the next unit',
    );
  }
  return locations;
}

function groupByValue(byUrl: ReadonlyMap<string, string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [url, value] of byUrl) {
    const urls = groups.get(value) ?? [];
    urls.push(url);
    groups.set(value, urls);
  }
  return groups;
}

function listOf(urls: readonly string[]): string {
  return `${urls.slice(0, 3).join(', ')}${urls.length > 3 ? ` and ${urls.length - 3} more` : ''}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const NO_REFERENCE = "no sourceMappingURL comment; build with devtool 'source-map' or "
  + "'cheap-module-source-map' (an eval-* devtool cannot be fetched)";

// Resolves to a definite answer; rejects when a fetch itself failed, so the
// caller can keep the first and forget the second (see `lookups`).
async function loadSourceMap(
  scriptUrl: string,
  fetchText: SourceResolveContext['fetchText'],
): Promise<LoadedSourceMap> {
  const script = await fetchText(scriptUrl);
  if (script === null) return none('the bundle itself could not be fetched (the server answered with an error)');
  // The bundle's own comment is the last one; an inlined module may carry its own.
  const reference = [...script.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/gm)].at(-1)?.[1];
  if (!reference) return none(NO_REFERENCE);
  if (reference.startsWith('data:')) {
    const label = 'its inline data: source map';
    try {
      const json = decodeDataUrl(reference);
      return json === null ? none(`${label} could not be read`) : parsed(label, json);
    } catch (err) {
      return none(`${label} could not be read: ${errorMessage(err)}`);
    }
  }
  let mapUrl: string;
  try {
    mapUrl = new URL(reference, scriptUrl).href;
  } catch (err) {
    return none(`its sourceMappingURL comment could not be read: ${errorMessage(err)}`);
  }
  const json = await fetchText(mapUrl);
  if (json === null) return none(`${mapUrl} could not be fetched (the server answered with an error)`);
  return parsed(mapUrl, json);
}

const none = (reason: string): LoadedSourceMap => ({ lookup: null, reason });

function parsed(label: string, json: string): LoadedSourceMap {
  try {
    return { lookup: SourceMapLookup.parse(json) };
  } catch (err) {
    return none(`${label} is not a usable source map: ${errorMessage(err)}`);
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
