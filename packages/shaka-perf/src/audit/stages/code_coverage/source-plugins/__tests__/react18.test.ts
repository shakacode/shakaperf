/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { SourceResolveContext } from 'shaka-shared';
import { react18ScreenshotCoveragePlugin } from '../react18';

type Source = { fileName: string; lineNumber: number; columnNumber?: number };
type Fiber = { _debugSource?: Source | null; _debugOwner?: Fiber | null };

const element = (fiber?: Fiber): Element =>
  (fiber ? { __reactFiber$k3x: fiber, __reactProps$k3x: {} } : {}) as unknown as Element;

const ROOT = '/home/me/app';
const APP_CARD: Source = { fileName: `${ROOT}/app/javascript/Card.jsx`, lineNumber: 12, columnNumber: 7 };
const APP_PAGE: Source = { fileName: `${ROOT}/app/javascript/Page.jsx`, lineNumber: 8, columnNumber: 3 };
const LIB_CHIP: Source = { fileName: `${ROOT}/node_modules/@mui/material/Chip.js`, lineNumber: 1 };

function harness() {
  const warnings: string[] = [];
  const context: SourceResolveContext = {
    pageUrl: 'http://h/',
    fetchText: async () => null,
    warn: (message) => { warnings.push(message); },
  };
  return { warnings, context };
}

describe('react18 locate (runs in the page)', () => {
  const { locate } = react18ScreenshotCoveragePlugin({ root: ROOT });

  it("returns the element's own source, then its owners'", () => {
    const owner: Fiber = { _debugSource: APP_PAGE, _debugOwner: null };
    const host: Fiber = { _debugSource: APP_CARD, _debugOwner: owner };
    expect(locate(element(host))).toEqual([APP_CARD, APP_PAGE]);
  });

  it('skips fibers without a source but keeps walking to the owners that have one', () => {
    const owner: Fiber = { _debugSource: APP_PAGE, _debugOwner: null };
    const styled: Fiber = { _debugSource: undefined, _debugOwner: owner };
    const host: Fiber = { _debugSource: null, _debugOwner: styled };
    expect(locate(element(host))).toEqual([APP_PAGE]);
  });

  it('returns null for an element React did not render', () => {
    expect(locate(element())).toBeNull();
  });

  it('flags a fiber tree without any source (production build, or no JSX source transform)', () => {
    expect(locate(element({ _debugOwner: { _debugOwner: null } }))).toBe('react18:no-debug-source');
  });

  it('is self-contained: its source text runs with nothing from this module', () => {
    const standalone = new Function(`return (${locate.toString()})`)() as typeof locate;
    expect(standalone(element({ _debugSource: APP_CARD, _debugOwner: null }))).toEqual([APP_CARD]);
  });
});

describe('react18 resolve (runs in Node)', () => {
  it('names the source relative to the root, with the column the transform recorded', async () => {
    const plugin = react18ScreenshotCoveragePlugin({ root: ROOT });
    const { context, warnings } = harness();
    await expect(plugin.resolve!([[APP_CARD]], context))
      .resolves.toEqual([{ path: 'app/javascript/Card.jsx', line: 12, column: 7 }]);
    expect(warnings).toEqual([]);
  });

  it('walks past a library source to the app component that used it', async () => {
    const plugin = react18ScreenshotCoveragePlugin({ root: ROOT });
    await expect(plugin.resolve!([[LIB_CHIP, APP_PAGE]], harness().context))
      .resolves.toEqual([{ path: 'app/javascript/Page.jsx', line: 8, column: 3 }]);
  });

  it('keeps order and length, with null for elements it cannot place', async () => {
    const plugin = react18ScreenshotCoveragePlugin({ root: ROOT });
    await expect(plugin.resolve!([null, [APP_CARD], [LIB_CHIP], 42, [{ fileName: 3 }]], harness().context))
      .resolves.toEqual([null, { path: 'app/javascript/Card.jsx', line: 12, column: 7 }, null, null, null]);
  });

  it('omits the column when the transform recorded none', async () => {
    const plugin = react18ScreenshotCoveragePlugin({ root: ROOT });
    await expect(plugin.resolve!([[{ fileName: `${ROOT}/app/javascript/Nav.jsx`, lineNumber: 5 }]], harness().context))
      .resolves.toEqual([{ path: 'app/javascript/Nav.jsx', line: 5 }]);
  });

  it('defaults the root to the working directory', async () => {
    const plugin = react18ScreenshotCoveragePlugin();
    await expect(plugin.resolve!([[{ fileName: `${process.cwd()}/app/x.jsx`, lineNumber: 2 }]], harness().context))
      .resolves.toEqual([{ path: 'app/x.jsx', line: 2 }]);
  });

  it('says "production build or no source transform" when fibers exist but carry no source', async () => {
    const plugin = react18ScreenshotCoveragePlugin({ root: ROOT });
    const { context, warnings } = harness();
    await expect(plugin.resolve!(['react18:no-debug-source', null], context)).resolves.toEqual([null, null]);
    expect(warnings).toEqual([expect.stringMatching(/1 React element\(s\) carry no fiber\._debugSource.*production build.*JSX source transform/)]);
  });

  it('says so when the page has no React at all', async () => {
    const plugin = react18ScreenshotCoveragePlugin({ root: ROOT });
    const { context, warnings } = harness();
    await plugin.resolve!([null], context);
    expect(warnings).toEqual([expect.stringMatching(/no React fibers on this page/)]);
  });

  it('lets a project redraw the line between its code and libraries', async () => {
    const plugin = react18ScreenshotCoveragePlugin({ root: ROOT, isAppSource: (path) => path.includes('@mui') });
    await expect(plugin.resolve!([[LIB_CHIP, APP_PAGE]], harness().context))
      .resolves.toEqual([{ path: 'node_modules/@mui/material/Chip.js', line: 1 }]);
  });
});
