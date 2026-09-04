/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  captureKindForSelector,
  formatVisibilityMap,
  scoreVisibility,
  type VisibilityNode,
  type VisibilityRect,
  type VisibilitySnapshot,
} from '../visibility-map';

const CAPTURE = { x: 0, y: 0, w: 100, h: 100 };

function node(rect: VisibilityRect | null, over: Partial<VisibilityNode> = {}): VisibilityNode {
  return {
    depth: 0,
    tag: 'div',
    selector: '.subject',
    rect,
    clipped: rect,
    hiddenByCss: false,
    unobscured: 1,
    ...over,
  };
}

// The rule these assert is visreg's, in runCompareScenario's captureScreenshot:
// `fullPage` is true ONLY for `body:noclip` and `document`. If that changes,
// these fail — which is the point, since a map scored against the wrong area
// reports elements as photographed that no screenshot contains.
describe('captureKindForSelector', () => {
  it('treats document and body:noclip as the whole page', () => {
    expect(captureKindForSelector('document')).toBe('document');
    expect(captureKindForSelector('body:noclip')).toBe('document');
  });

  it('treats body as the VIEWPORT, not the page', () => {
    // visreg captures `body` with fullPage:false — same shot as `viewport`.
    expect(captureKindForSelector('body')).toBe('viewport');
    expect(captureKindForSelector('viewport')).toBe('viewport');
  });

  it('treats anything else as an element box', () => {
    expect(captureKindForSelector('.pm-menus-bg')).toBe('element');
    expect(captureKindForSelector('#navbar')).toBe('element');
    expect(captureKindForSelector('body > main')).toBe('element');
  });
});

describe('scoreVisibility', () => {
  it('scores an element wholly inside the capture region at 100', () => {
    expect(scoreVisibility(node({ x: 10, y: 10, w: 50, h: 20 }), [CAPTURE])).toEqual({ percent: 100 });
  });

  it('scores the share that overlaps, not the whole box', () => {
    // Half its width hangs off the right edge of the capture region.
    expect(scoreVisibility(node({ x: 50, y: 0, w: 100, h: 10 }), [CAPTURE]))
      .toEqual({ percent: 50, reason: 'outside capture' });
  });

  it('reports an unrendered element as not rendered, not merely 0%', () => {
    expect(scoreVisibility(node(null), [CAPTURE])).toEqual({ percent: 0, reason: 'not rendered' });
  });

  it('zeroes a CSS-hidden element that still has a box', () => {
    const hidden = node({ x: 0, y: 0, w: 10, h: 10 }, { hiddenByCss: true });
    expect(scoreVisibility(hidden, [CAPTURE])).toEqual({ percent: 0, reason: 'hidden by CSS' });
  });

  it('reduces an element cropped by an ancestor overflow to the visible crop', () => {
    const clipped = node(
      { x: 0, y: 0, w: 100, h: 100 },
      { clipped: { x: 0, y: 0, w: 100, h: 25 } },
    );
    expect(scoreVisibility(clipped, [CAPTURE])).toEqual({ percent: 25, reason: 'clipped by ancestor' });
  });

  it('reduces an element covered by an overlay, and names occlusion as the cause', () => {
    const covered = node({ x: 0, y: 0, w: 100, h: 100 }, { unobscured: 1 / 3 });
    expect(scoreVisibility(covered, [CAPTURE])).toEqual({ percent: 33, reason: 'obscured' });
  });

  it('names the biggest cause when several apply', () => {
    // Half outside the capture region, and 1/3 of the rest covered: the crop
    // loses more area than the overlay does.
    const both = node({ x: 50, y: 0, w: 100, h: 100 }, { unobscured: 2 / 3 });
    expect(scoreVisibility(both, [CAPTURE])).toEqual({ percent: 33, reason: 'outside capture' });
  });

  it('scores unmeasured occlusion as unobscured rather than as a hole', () => {
    // Scrolled out of the viewport: hit-testing could not run there.
    const offscreen = node({ x: 0, y: 0, w: 50, h: 50 }, { unobscured: null });
    expect(scoreVisibility(offscreen, [CAPTURE])).toEqual({ percent: 100 });
  });

  it('scores 0 when the test captured nothing (no selector resolved)', () => {
    expect(scoreVisibility(node({ x: 0, y: 0, w: 10, h: 10 }), []))
      .toEqual({ percent: 0, reason: 'outside capture' });
  });

  it('counts overlapping capture regions once', () => {
    // Two regions that both cover the left half; naive summing would report 200%.
    const regions = [{ x: 0, y: 0, w: 50, h: 10 }, { x: 0, y: 0, w: 50, h: 10 }];
    expect(scoreVisibility(node({ x: 0, y: 0, w: 100, h: 10 }), regions).percent).toBe(50);
  });

  it('adds up disjoint capture regions', () => {
    const regions = [{ x: 0, y: 0, w: 25, h: 10 }, { x: 50, y: 0, w: 25, h: 10 }];
    expect(scoreVisibility(node({ x: 0, y: 0, w: 100, h: 10 }), regions).percent).toBe(50);
  });
});

describe('formatVisibilityMap', () => {
  const snapshot: VisibilitySnapshot = {
    url: 'http://localhost:3090/',
    testName: 'Homepage',
    viewportLabel: 'phone',
    selectors: ['document'],
    regions: [CAPTURE],
    truncated: false,
    nodes: [
      node({ x: 0, y: 0, w: 100, h: 300 }, { tag: 'div', selector: '#consumer-app' }),
      node({ x: 0, y: 0, w: 100, h: 50 }, { depth: 1, tag: 'nav', selector: '#navbar,.nav' }),
      node(null, { depth: 2, tag: 'span', selector: '.hidden-menu', clipped: null }),
    ],
  };

  it('indents by nesting and reports each box with its visible share', () => {
    const lines = formatVisibilityMap(snapshot).split('\n');
    expect(lines).toContain('div #consumer-app => 0,0,100,300 33% visible (outside capture)');
    expect(lines).toContain('  nav #navbar,.nav => 0,0,100,50 100% visible');
    expect(lines).toContain('    span .hidden-menu => 0,0,0,0 0% visible (not rendered)');
  });

  it('names the capture region, so a reader knows what the percentages are of', () => {
    expect(formatVisibilityMap(snapshot)).toContain('# capture regions: 0,0,100,100');
  });

  it('says so when no selector resolved, rather than reporting a silent all-zero page', () => {
    expect(formatVisibilityMap({ ...snapshot, regions: [] })).toContain('nothing would be captured');
  });

  it('flags a truncated walk instead of passing off a partial tree as the page', () => {
    expect(formatVisibilityMap({ ...snapshot, truncated: true })).toContain('# TRUNCATED');
  });

  it('writes nothing about sources when no plugin ran, so the bytes are unchanged', () => {
    const text = formatVisibilityMap(snapshot);
    expect(text).not.toContain('source plugin');
    expect(text).not.toContain(' @ ');
  });

  it('ends a row in @ path:line[:col] when the plugin placed its element, and says how many it placed', () => {
    const attributed: VisibilitySnapshot = {
      ...snapshot,
      nodes: [
        node({ x: 0, y: 0, w: 100, h: 50 }, {
          tag: 'nav', selector: '#navbar', source: { path: 'app/javascript/Nav.tsx', line: 41, column: 7 },
        }),
        node({ x: 0, y: 50, w: 100, h: 100 }, { tag: 'p', selector: '.cheap', source: { path: 'app/javascript/P.tsx', line: 9 } }),
        node({ x: 0, y: 90, w: 100, h: 10 }, { tag: 'i', selector: '.unplaced' }),
      ],
      sourceAttribution: { plugin: 'react19', located: 2, elements: 3, warnings: ['one bundle had\nno map'] },
    };
    const lines = formatVisibilityMap(attributed).split('\n');
    expect(lines).toContain('# source plugin: react19 — 2 of 3 elements located');
    expect(lines).toContain('#   one bundle had no map');
    expect(lines).toContain('nav #navbar => 0,0,100,50 100% visible @ app/javascript/Nav.tsx:41:7');
    expect(lines).toContain('p .cheap => 0,50,100,100 50% visible (outside capture) @ app/javascript/P.tsx:9');
    expect(lines).toContain('i .unplaced => 0,90,100,10 100% visible');
  });
});
