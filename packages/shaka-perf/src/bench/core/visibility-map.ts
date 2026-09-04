/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Page } from 'playwright-core';
import type { ScreenshotCoveragePlugin, SourceLocation } from 'shaka-shared';
import { pageFunctionSource } from './page-function-source';

/**
 * A depth-first snapshot of what the finished page actually shows, scored
 * against the region a visreg screenshot of this test would keep.
 *
 * Code coverage says a test EXECUTED a component; this says the component
 * ENDED UP IN THE PICTURE. The two are read side by side (see the
 * `shaka-perf-coverage` skill): a line covered by a test whose element is 0%
 * visible is a hole no code-coverage number can show.
 *
 * "Visible" is the whole chain a screenshot applies, not just geometry:
 * rendered at all → not hidden by CSS → not clipped away by an ancestor's
 * overflow → inside the capture region → not covered by something painted on
 * top (a modal, a sticky bar, a cookie banner).
 */
export const VISIBILITY_MAP_FILENAME = 'visibility-map.txt';

/** Document-coordinate box: x/y from the document origin, not the viewport. */
export interface VisibilityRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisibilityNode {
  /** Nesting level; 0 for `document.body`'s own children. */
  depth: number;
  tag: string;
  /** `[data-testid="x"],[role="tab"],#id,.cls`, or '' when the element has none. */
  selector: string;
  /** Border box. Null when the element renders no box at all (display:none). */
  rect: VisibilityRect | null;
  /**
   * `rect` after every ancestor's overflow clipping. A card inside an
   * `overflow:hidden` carousel track is only as visible as the track shows it.
   */
  clipped: VisibilityRect | null;
  /** `visibility:hidden`, `opacity:0`, or `content-visibility:hidden`. */
  hiddenByCss: boolean;
  /**
   * Share (0–1) of sampled points where this element (or a descendant) is the
   * topmost thing painted — i.e. NOT covered by an overlay. `null` when it
   * could not be sampled: hit-testing only works inside the current viewport,
   * so anything scrolled out of view is left unmeasured rather than guessed.
   */
  unobscured: number | null;
  /** Set by the `screenshotCoveragePlugin` when it could place the element. */
  source?: SourceLocation;
}

export type SourceAttribution = {
  plugin: string;
  located: number;
  elements: number;
  warnings: string[];
};

export interface VisibilitySnapshot {
  url: string;
  testName: string;
  viewportLabel: string;
  /** The test's `visregSelectors` (`['document']` when it declares none). */
  selectors: string[];
  /** What those selectors resolve to — the area a screenshot would keep. */
  regions: VisibilityRect[];
  nodes: VisibilityNode[];
  /** True when the walk hit `MAX_NODES` and stopped early. */
  truncated: boolean;
  /** Present only when a `screenshotCoveragePlugin` ran over this page. */
  sourceAttribution?: SourceAttribution;
}

/** Why an element scores below 100%. */
export type VisibilityReason =
  | 'not rendered'
  | 'hidden by CSS'
  | 'clipped by ancestor'
  | 'outside capture'
  | 'obscured';

export interface VisibilityScore {
  percent: number;
  reason?: VisibilityReason;
}

/** What a visreg capture of one selector actually photographs. */
export type CaptureKind = 'document' | 'viewport' | 'element';

/**
 * The selector → captured-area rule, mirroring `runCompareScenario`'s
 * `captureScreenshot`. Note `body`: it is NOT the whole page. Only `document`
 * and `body:noclip` pass `fullPage: true`; `body` falls through to a plain
 * `page.screenshot()`, which is the viewport. Modelling it as the document
 * would score everything below the fold as captured when no screenshot ever
 * shows it — a false positive in the one direction this map must not err.
 *
 * Lives here, in Node, rather than inside the in-page collector so it can be
 * tested against the engine it mirrors.
 */
export function captureKindForSelector(selector: string): CaptureKind {
  if (selector === 'document' || selector === 'body:noclip') return 'document';
  if (selector === 'body' || selector === 'viewport') return 'viewport';
  return 'element';
}

// A whole-page walk of a content-heavy page runs a few thousand elements. The
// cap keeps one unit's artifact bounded; hitting it is recorded in the header
// rather than silently trimming the tail.
const MAX_NODES = 4000;

// Tags that never carry visible layout of their own. Their subtrees go with
// them: none of it can appear in a screenshot.
const SKIP_TAGS = ['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'BASE'];

// Tags whose children are graphical/media internals, not page structure. The
// element itself is reported; its subtree is not walked.
const LEAF_TAGS = ['SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'PICTURE', 'SELECT', 'TEXTAREA'];

// Attributes that NAME an element rather than style it, in the order a reader should trust
// them. Everything here was written deliberately and survives a rebuild, which is what makes
// a row traceable back to the source that rendered it — a CSS-in-JS class like `.jss159` or
// `.css-1a2b3c` is regenerated per build and identifies nothing.
//
// The ARIA half earns its place twice over: for plenty of components `role` or `aria-label`
// is the only stable hook in the markup, and it is also what the tests themselves select on,
// so a map carrying it can be read against the test that produced it.
const IDENTIFYING_ATTRIBUTES = [
  'data-testid', 'data-test-id', 'data-cy', 'data-qa', 'data-tour-id',
  'role', 'aria-label', 'aria-current', 'aria-selected',
];

/**
 * How much of `node` a screenshot over `regions` would actually show, as a
 * whole percentage of its own box, plus the dominant reason when that is not
 * 100%.
 */
export function scoreVisibility(
  node: VisibilityNode,
  regions: readonly VisibilityRect[],
): VisibilityScore {
  const box = node.rect;
  if (!box || box.w <= 0 || box.h <= 0) return { percent: 0, reason: 'not rendered' };
  if (node.hiddenByCss) return { percent: 0, reason: 'hidden by CSS' };

  const boxArea = area(box);
  const clippedArea = area(node.clipped);
  const capturedArea = intersectionArea(node.clipped, regions);
  // Unmeasured occlusion (element scrolled out of the current viewport) counts
  // as unobscured: reporting a guess as a loss would read as a real hole.
  const visibleArea = capturedArea * (node.unobscured ?? 1);

  const losses: Array<[VisibilityReason, number]> = [
    ['clipped by ancestor', boxArea - clippedArea],
    ['outside capture', clippedArea - capturedArea],
    ['obscured', capturedArea - visibleArea],
  ];
  const percent = Math.round((visibleArea / boxArea) * 100);
  if (percent >= 100) return { percent: 100 };
  const worst = losses.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { percent, ...(worst[1] > 0 ? { reason: worst[0] } : {}) };
}

function area(rect: VisibilityRect | null): number {
  return rect ? Math.max(0, rect.w) * Math.max(0, rect.h) : 0;
}

function intersect(a: VisibilityRect, b: VisibilityRect): VisibilityRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

function intersectionArea(
  rect: VisibilityRect | null,
  regions: readonly VisibilityRect[],
): number {
  if (!rect) return 0;
  const clipped = regions
    .map((region) => intersect(rect, region))
    .filter((r): r is VisibilityRect => r !== null);
  return clipped.length === 0 ? 0 : unionArea(clipped);
}

// Overlapping capture regions (a test may name several selectors that nest)
// must not be double-counted, so the union goes through coordinate
// compression: split the plane on every rect edge and count each cell once.
// Region counts are single digits, so the O(n²) grid is free.
function unionArea(rects: readonly VisibilityRect[]): number {
  if (rects.length === 1) return area(rects[0]);
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < ys.length - 1; j += 1) {
      const cell = { x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j] };
      if (rects.some((r) => intersect(cell, r) !== null)) total += area(cell);
    }
  }
  return total;
}

function formatRect(rect: VisibilityRect | null): string {
  if (!rect) return '0,0,0,0';
  return `${rect.x},${rect.y},${rect.w},${rect.h}`;
}

/**
 * The artifact text: a header naming what a screenshot of this test would
 * keep, then one indented line per element in document order.
 *
 *   div #consumer-app => 0,0,1920,3020 30% visible (outside capture)
 *     nav #navbar,.nav => 0,0,1920,100 100% visible
 */
export function formatVisibilityMap(snapshot: VisibilitySnapshot): string {
  const lines = [
    `# test: ${snapshot.testName}`,
    `# viewport: ${snapshot.viewportLabel}`,
    `# url: ${snapshot.url}`,
    `# visregSelectors: ${snapshot.selectors.join(', ')}`,
    `# capture regions: ${snapshot.regions.length === 0
      ? '(none — no selector resolved, nothing would be captured)'
      : snapshot.regions.map(formatRect).join(' ')}`,
    '# format: <indent by nesting> tag [data-testid="x"],[role="tab"],#id,.class => x,y,w,h N% visible (reason)',
    '#   Naming attributes (data-testid/-cy/-qa/-tour-id, role, aria-label/-current/-selected)',
    '#   come first: they are what survives a rebuild, unlike CSS-in-JS names like .jss159.',
    "# \"visible\" = the share of the element's box a screenshot would show: rendered,",
    '#   not hidden by CSS (visibility/opacity/content-visibility), not clipped away by',
    "#   an ancestor's overflow, inside the capture regions above, and not covered by",
    '#   something painted on top (modal, sticky bar, cookie banner).',
    '# Occlusion is sampled by hit-testing a 3x3 grid, which only works inside the',
    '#   current viewport — an element scrolled out of view is scored without it.',
  ];
  const attribution = snapshot.sourceAttribution;
  if (attribution) {
    lines.push(
      `# source plugin: ${attribution.plugin} — ${attribution.located} of ${attribution.elements} elements located`,
      '#   A row ending in `@ path:line[:col]` names where in the app source its element was written.',
      ...attribution.warnings.map((warning) => `#   ${warning.replace(/\s*\n\s*/g, ' ')}`),
    );
  }
  if (snapshot.truncated) {
    lines.push(`# TRUNCATED: walk stopped at ${MAX_NODES} elements; the tail of the page is missing.`);
  }
  for (const node of snapshot.nodes) {
    const label = node.selector ? `${node.tag} ${node.selector}` : node.tag;
    const score = scoreVisibility(node, snapshot.regions);
    lines.push(
      `${'  '.repeat(node.depth)}${label} => ${formatRect(node.rect)} ` +
      `${score.percent}% visible${score.reason ? ` (${score.reason})` : ''}` +
      `${node.source ? ` @ ${formatSourceLocation(node.source)}` : ''}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** `app/javascript/Nav.tsx:41:7`, or `…:41` when the map had no column detail. */
export function formatSourceLocation(source: SourceLocation): string {
  return `${source.path}:${source.line}${source.column !== undefined ? `:${source.column}` : ''}`;
}

interface CollectorInput {
  selectors: Array<{ selector: string; kind: CaptureKind }>;
  maxNodes: number;
  skipTags: string[];
  leafTags: string[];
  identifyingAttributes: string[];
}

interface CollectedSnapshot {
  url: string;
  regions: VisibilityRect[];
  nodes: VisibilityNode[];
  truncated: boolean;
  /** What the plugin's `locate` returned, one entry per node. */
  sourceRaws: unknown[];
}

/**
 * Read the finished page's element tree and the region a visreg capture of
 * this test would keep. Runs in the browser, so it stays a self-contained
 * function over plain data — no imports, no closure over module scope.
 *
 * Each selector arrives with its capture kind already resolved (see
 * `captureKindForSelector`); this only turns a kind into a rectangle.
 * `locate` is the plugin's page half, spliced in by source text.
 */
function collectVisibility(
  input: CollectorInput,
  locate: ((element: Element) => unknown) | null,
): CollectedSnapshot {
  const round = (value: number): number => Math.round(value);
  const toDocRect = (rect: DOMRect): VisibilityRect => ({
    x: round(rect.x + window.scrollX),
    y: round(rect.y + window.scrollY),
    w: round(rect.width),
    h: round(rect.height),
  });
  const documentRect = (): VisibilityRect => ({
    x: 0,
    y: 0,
    w: round(Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0)),
    h: round(Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)),
  });
  const clipRects = (a: VisibilityRect, b: VisibilityRect): VisibilityRect | null => {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= x || bottom <= y) return null;
    return { x, y, w: right - x, h: bottom - y };
  };

  const viewport: VisibilityRect = {
    x: round(window.scrollX),
    y: round(window.scrollY),
    w: round(window.innerWidth),
    h: round(window.innerHeight),
  };

  const regions: VisibilityRect[] = [];
  // A selector that matches nothing — or matches something with no box, which
  // makes visreg's `boundingBox()` null and its capture null — photographs
  // nothing. Dropping it here is what lets an all-empty list report "nothing
  // would be captured" instead of a 0x0 region nobody can read.
  const addRegion = (rect: VisibilityRect): void => {
    if (rect.w > 0 && rect.h > 0) regions.push(rect);
  };
  for (const { selector, kind } of input.selectors) {
    if (kind === 'document') {
      addRegion(documentRect());
      continue;
    }
    if (kind === 'viewport') {
      addRegion({ ...viewport });
      continue;
    }
    let element: Element | null = null;
    try {
      element = document.querySelector(selector);
    } catch {
      element = null;
    }
    if (element) addRegion(toDocRect(element.getBoundingClientRect()));
  }

  // Fraction of a 3x3 grid over `rect` where this element (or a descendant) is
  // the topmost painted thing. Hit-testing is viewport-only, so sample the part
  // of the element currently on screen and report null when none of it is.
  const sampleUnobscured = (element: Element, rect: VisibilityRect): number | null => {
    const onScreen = clipRects(rect, viewport);
    if (!onScreen) return null;
    let hits = 0;
    let taken = 0;
    for (const fx of [0.15, 0.5, 0.85]) {
      for (const fy of [0.15, 0.5, 0.85]) {
        const x = onScreen.x + onScreen.w * fx - window.scrollX;
        const y = onScreen.y + onScreen.h * fy - window.scrollY;
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        taken += 1;
        const top = document.elementFromPoint(x, y);
        // A descendant on top is still this element showing; an unrelated
        // element (a modal, a sticky bar, a cookie banner) is not.
        if (top && (top === element || element.contains(top))) hits += 1;
      }
    }
    return taken === 0 ? null : hits / taken;
  };

  const skip = new Set(input.skipTags);
  const leaf = new Set(input.leafTags);
  const nodes: VisibilityNode[] = [];
  const sourceRaws: unknown[] = [];
  let truncated = false;

  const walk = (element: Element, depth: number, clip: VisibilityRect | null): void => {
    // SVG/MathML elements report a lower-case tagName, HTML an upper-case one.
    const tagName = element.tagName.toUpperCase();
    if (skip.has(tagName)) return;
    if (nodes.length >= input.maxNodes) {
      truncated = true;
      return;
    }
    // Naming attributes come first: they are the only part of this label a reader can rely
    // on, and for many components they are the only stable part that exists.
    const hooks = input.identifyingAttributes
      .filter((name) => element.hasAttribute(name))
      .map((name) => `[${name}="${element.getAttribute(name)}"]`);
    const classes = Array.from(element.classList).slice(0, 3).map((c) => `.${c}`);
    const parts = [...hooks, ...(element.id ? [`#${element.id}`] : []), ...classes];
    // getClientRects() is empty for display:none and for wrappers that lay out
    // nothing; getBoundingClientRect() would report a 0x0 box at the origin,
    // which reads as "at the top of the page" rather than "not rendered".
    const rendered = element.getClientRects().length > 0;
    const rect = rendered ? toDocRect(element.getBoundingClientRect()) : null;
    const style = rendered ? window.getComputedStyle(element) : null;
    const hiddenByCss = !!style && (
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      Number(style.opacity) === 0 ||
      style.contentVisibility === 'hidden'
    );
    const clipped = rect && clip ? clipRects(rect, clip) : rect;
    nodes.push({
      depth,
      tag: tagName.toLowerCase(),
      selector: parts.join(','),
      rect,
      clipped,
      hiddenByCss,
      // Nothing to hit-test when the element already shows nothing; skipping
      // those keeps a normal page to a few hundred hit-tests.
      unobscured: clipped && !hiddenByCss ? sampleUnobscured(element, clipped) : null,
    });
    if (locate) sourceRaws.push(locate(element));
    // Nothing under an unrendered element can reach a screenshot, and its
    // subtree is where the bulk of a hidden menu/modal's markup lives.
    if (!rendered || leaf.has(tagName)) return;
    // An ancestor that scrolls or hides its overflow crops every descendant to
    // its own box — the same crop a screenshot sees.
    const clipsChildren = !!style && (style.overflowX !== 'visible' || style.overflowY !== 'visible');
    const childClip = clipsChildren && clipped ? clipped : clip;
    for (const child of Array.from(element.children)) walk(child, depth + 1, childClip);
  };

  const root = document.body ?? document.documentElement;
  for (const child of Array.from(root.children)) walk(child, 0, null);

  return { url: window.location.href, regions, nodes, truncated, sourceRaws };
}

export interface VisibilityMapOptions {
  selectors: readonly string[] | undefined;
  testName: string;
  viewportLabel: string;
  /** The configured `codeCoverage.screenshotCoveragePlugin`, already resolved. */
  sourcePlugin?: ScreenshotCoveragePlugin;
}

/**
 * Snapshot the live page. Mirrors what a visreg capture of this test would
 * keep, so it has to run at the same moment a screenshot would be taken:
 * after the test body settles, before the page is torn down.
 *
 * Call it on a page whose context went through `setUpContextForNavigation`,
 * as every stage engine does. The collector below has named inner helpers,
 * which esbuild's `keepNames` rewrites to `__name(fn, '…')` when this module
 * runs from source — a helper that exists in Node, not in the page. That setup
 * installs the shim which defines it (compiled `dist` code has no such call at
 * all, so this only bites a source-mode caller that skipped the setup).
 */
export async function captureVisibilitySnapshot(
  page: Page,
  options: VisibilityMapOptions,
): Promise<VisibilitySnapshot> {
  // Defaulting matches `convertAbTestToScenario`: no `visregSelectors` means
  // visreg screenshots the whole document.
  const selectors = options.selectors?.length ? [...options.selectors] : ['document'];
  const input: CollectorInput = {
    selectors: selectors.map((selector) => ({ selector, kind: captureKindForSelector(selector) })),
    maxNodes: MAX_NODES,
    skipTags: SKIP_TAGS,
    leafTags: LEAF_TAGS,
    identifyingAttributes: IDENTIFYING_ATTRIBUTES,
  };
  const plugin = options.sourcePlugin;
  // A string expression rather than `evaluate(fn, arg)`, so the plugin's page
  // half can be spliced in by source text.
  const locate = plugin
    ? pageFunctionSource(plugin.locate, `screenshotCoveragePlugin "${plugin.name}".locate`)
    : 'null';
  const { sourceRaws, ...collected } = await page.evaluate<CollectedSnapshot>(
    `(${collectVisibility.toString()})(${JSON.stringify(input)}, ${locate})`,
  );
  const sourceAttribution = plugin
    ? await attributeSources(plugin, sourceRaws, collected.nodes, page, collected.url)
    : undefined;
  return {
    ...collected,
    testName: options.testName,
    viewportLabel: options.viewportLabel,
    selectors,
    ...(sourceAttribution ? { sourceAttribution } : {}),
  };
}

async function attributeSources(
  plugin: ScreenshotCoveragePlugin,
  raws: readonly unknown[],
  nodes: VisibilityNode[],
  page: Page,
  pageUrl: string,
): Promise<SourceAttribution> {
  const warnings: string[] = [];
  const locations = plugin.resolve
    ? await plugin.resolve(raws, {
      pageUrl,
      fetchText: (url) => fetchTextViaPage(page, url),
      warn: (message) => { warnings.push(message); },
    })
    : (raws as readonly (SourceLocation | null)[]);
  let located = 0;
  locations.forEach((location, index) => {
    if (!location) return;
    nodes[index].source = location;
    located += 1;
  });
  return { plugin: plugin.name, located, elements: nodes.length, warnings };
}

// The browser context's own request client, so a dev server behind a cookie or
// proxy answers the way it answered the page.
async function fetchTextViaPage(page: Page, url: string): Promise<string | null> {
  if (!/^https?:\/\//.test(url)) return null;
  try {
    const response = await page.context().request.get(url, { maxRedirects: 5, timeout: 30_000 });
    return response.ok() ? await response.text() : null;
  } catch {
    return null;
  }
}
