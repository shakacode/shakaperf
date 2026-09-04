/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { SourceResolveContext } from 'shaka-shared';
import {
  isAppSourceByDefault,
  normalizeSourcePath,
  react19ScreenshotCoveragePlugin,
} from '../react19';
import { encodeMappings } from './encode-mappings';

// --- the page half -----------------------------------------------------------

type Fiber = { _debugStack?: { stack?: unknown } | null; _debugOwner?: Fiber | null };

const REACT_FRAME = '    at exports.jsx (http://h/vendor.js:1:2)';
const stackOf = (...frames: string[]) => ['Error: react-stack-top-frame', REACT_FRAME, ...frames].join('\n');
const element = (fiber?: Fiber): Element =>
  (fiber ? { __reactFiber$k3x: fiber, __reactProps$k3x: {} } : {}) as unknown as Element;

describe('react19 locate (runs in the page)', () => {
  const { locate } = react19ScreenshotCoveragePlugin();

  it('returns the stack frames of the element, then of the components that rendered it', () => {
    const owner: Fiber = { _debugStack: { stack: stackOf('    at Page (http://h/app.js:30:5)') }, _debugOwner: null };
    const host: Fiber = {
      _debugStack: { stack: stackOf('    at Card (http://h/app.js:10:20)', '    at renderWithHooks (http://h/vendor.js:3:4)') },
      _debugOwner: owner,
    };
    expect(locate(element(host))).toEqual([
      REACT_FRAME, '    at Card (http://h/app.js:10:20)', '    at renderWithHooks (http://h/vendor.js:3:4)',
      REACT_FRAME, '    at Page (http://h/app.js:30:5)',
    ]);
  });

  it('returns null for an element React did not render', () => {
    expect(locate(element())).toBeNull();
  });

  it('flags a fiber without a debug stack (a production build) rather than returning nothing', () => {
    expect(locate(element({ _debugOwner: null }))).toBe('react19:no-debug-stack');
    expect(locate(element({ _debugStack: null, _debugOwner: { _debugStack: undefined } }))).toBe('react19:no-debug-stack');
  });

  it('is self-contained: its source text runs with nothing from this module', () => {
    const standalone = new Function(`return (${locate.toString()})`)() as typeof locate;
    const host: Fiber = { _debugStack: { stack: stackOf('    at Card (http://h/app.js:10:20)') }, _debugOwner: null };
    expect(standalone(element(host))).toEqual([REACT_FRAME, '    at Card (http://h/app.js:10:20)']);
  });
});

// --- the Node half -----------------------------------------------------------

const APP_SOURCES = [
  'webpack://demo/./app/javascript/Card.tsx',
  'webpack://demo/./node_modules/@mui/material/Chip.js',
  'webpack://demo/./app/javascript/Page.tsx',
];
// app.js line 10 col 19 (0-based) → Card.tsx 12:6; line 30 col 4 → Page.tsx 8:2;
// line 50 col 7 → the MUI Chip.
const appLines: number[][][] = Array.from({ length: 50 }, () => []);
appLines[9] = [[19, 0, 12, 6]];
appLines[29] = [[4, 2, 8, 2]];
appLines[49] = [[7, 1, 1, 0]];
const APP_MAP = JSON.stringify({ version: 3, sources: APP_SOURCES, mappings: encodeMappings(appLines) });
const VENDOR_MAP = JSON.stringify({
  version: 3,
  sources: ['webpack://demo/./node_modules/react/cjs/react-jsx-runtime.development.js'],
  mappings: encodeMappings([[[1, 0, 1, 0]], [], [[3, 0, 1, 0]]]),
});
// A `cheap-*` map: line 1 col 0 → Nav.tsx line 5, no column detail.
const CHEAP_MAP = JSON.stringify({
  version: 3,
  sources: ['webpack://demo/./app/javascript/Nav.tsx'],
  mappings: encodeMappings([[[0, 0, 5, 0]]]),
});

const FILES: Record<string, string> = {
  'http://h/app.js': '/* bundle */\n//# sourceMappingURL=app.js.map\n',
  'http://h/app.js.map': APP_MAP,
  'http://h/vendor.js': '//# sourceMappingURL=vendor.js.map',
  'http://h/vendor.js.map': VENDOR_MAP,
  'http://h/cheap.js': `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(CHEAP_MAP).toString('base64')}`,
  'http://h/nomap.js': 'nothing to see',
};

function harness() {
  const warnings: string[] = [];
  const fetched: string[] = [];
  const context: SourceResolveContext = {
    pageUrl: 'http://h/',
    fetchText: async (url) => {
      fetched.push(url);
      return FILES[url] ?? null;
    },
    warn: (message) => { warnings.push(message); },
  };
  return { warnings, fetched, context };
}

const OWN_APP_FRAMES = [REACT_FRAME, '    at Card (http://h/app.js:10:20)', '    at renderWithHooks (http://h/vendor.js:3:4)'];
const LIBRARY_DOM_FRAMES = [
  REACT_FRAME, '    at Chip (http://h/app.js:50:8)', // the Chip's own <div>, written in MUI
  REACT_FRAME, '    at Page (http://h/app.js:30:5)', // <Chip> as Page.tsx wrote it
];

describe('react19 resolve (runs in Node)', () => {
  it('names the source of the frame that lands in app code, skipping React runtime frames', async () => {
    const plugin = react19ScreenshotCoveragePlugin();
    const { context, warnings } = harness();
    await expect(plugin.resolve!([OWN_APP_FRAMES], context))
      .resolves.toEqual([{ path: 'app/javascript/Card.tsx', line: 12, column: 7 }]);
    expect(warnings).toEqual([]);
  });

  it('walks past DOM a library rendered to the app component that used it', async () => {
    const plugin = react19ScreenshotCoveragePlugin();
    await expect(plugin.resolve!([LIBRARY_DOM_FRAMES], harness().context))
      .resolves.toEqual([{ path: 'app/javascript/Page.tsx', line: 8, column: 3 }]);
  });

  it('keeps order and length, with null for elements it cannot place', async () => {
    const plugin = react19ScreenshotCoveragePlugin();
    await expect(plugin.resolve!([null, OWN_APP_FRAMES, [REACT_FRAME], 42], harness().context))
      .resolves.toEqual([null, { path: 'app/javascript/Card.tsx', line: 12, column: 7 }, null, null]);
  });

  it('omits the column when the map has no column detail, and reads an inline data: map', async () => {
    const plugin = react19ScreenshotCoveragePlugin();
    await expect(plugin.resolve!([['    at Nav (http://h/cheap.js:1:1)']], harness().context))
      .resolves.toEqual([{ path: 'app/javascript/Nav.tsx', line: 5 }]);
  });

  it('says "production build" when fibers exist but carry no stack', async () => {
    const plugin = react19ScreenshotCoveragePlugin();
    const { context, warnings } = harness();
    await expect(plugin.resolve!(['react19:no-debug-stack', 'react19:no-debug-stack', null], context))
      .resolves.toEqual([null, null, null]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/2 React element\(s\) carry no owner stack.*production React build/);
  });

  it('says so when the page has no React at all', async () => {
    const plugin = react19ScreenshotCoveragePlugin();
    const { context, warnings } = harness();
    await plugin.resolve!([null, null], context);
    expect(warnings).toEqual([expect.stringMatching(/no React fibers on this page/)]);
  });

  it('names a bundle it found no source map for', async () => {
    const plugin = react19ScreenshotCoveragePlugin();
    const { context, warnings } = harness();
    await expect(plugin.resolve!([['    at X (http://h/nomap.js:1:1)']], context)).resolves.toEqual([null]);
    expect(warnings).toEqual([expect.stringMatching(/no usable source map for http:\/\/h\/nomap\.js.*devtool/)]);
  });

  it('fetches each bundle and its map once for the life of the plugin', async () => {
    const plugin = react19ScreenshotCoveragePlugin();
    const { context, fetched } = harness();
    await plugin.resolve!([OWN_APP_FRAMES, OWN_APP_FRAMES], context);
    await plugin.resolve!([LIBRARY_DOM_FRAMES], context);
    expect(fetched.sort()).toEqual([
      'http://h/app.js', 'http://h/app.js.map', 'http://h/vendor.js', 'http://h/vendor.js.map',
    ]);
  });

  it('lets a project redraw the line between its code and libraries', async () => {
    const plugin = react19ScreenshotCoveragePlugin({ isAppSource: (path) => path.includes('@mui') });
    await expect(plugin.resolve!([LIBRARY_DOM_FRAMES], harness().context))
      .resolves.toEqual([{ path: 'node_modules/@mui/material/Chip.js', line: 1 }]);
  });

  it('ignores frames whose URL is not fetchable', async () => {
    const plugin = react19ScreenshotCoveragePlugin();
    const { context, warnings } = harness();
    await expect(plugin.resolve!([['    at x (webpack-internal:///./x.js:1:1)', '    at <anonymous>', '    at Card (http://h/app.js:10:20)']], context))
      .resolves.toEqual([{ path: 'app/javascript/Card.tsx', line: 12, column: 7 }]);
    expect(warnings).toEqual([]);
  });
});

describe('normalizeSourcePath', () => {
  it('strips the bundler scheme, relative prefix, loaders, and query', () => {
    expect(normalizeSourcePath('webpack://demo-ecommerce/./app/javascript/Nav.tsx')).toBe('app/javascript/Nav.tsx');
    expect(normalizeSourcePath('webpack:///./app/x.ts?1a2b')).toBe('app/x.ts');
    expect(normalizeSourcePath('css-loader!./app/x.css')).toBe('app/x.css');
    expect(normalizeSourcePath('app/y.tsx')).toBe('app/y.tsx');
  });
});

describe('isAppSourceByDefault', () => {
  it('counts the app\'s own files and nothing installed or bundler-made', () => {
    expect(isAppSourceByDefault('app/javascript/Nav.tsx')).toBe(true);
    expect(isAppSourceByDefault('node_modules/react/index.js')).toBe(false);
    expect(isAppSourceByDefault('../../.yarn/__virtual__/react-virtual-1/0/cache/react.zip/node_modules/react/index.js')).toBe(false);
    expect(isAppSourceByDefault('webpack/bootstrap')).toBe(false);
    expect(isAppSourceByDefault('webpack/runtime/define property getters')).toBe(false);
    expect(isAppSourceByDefault('(webpack)/buildin/global.js')).toBe(false);
    expect(isAppSourceByDefault('external commonjs "react"')).toBe(false);
    expect(isAppSourceByDefault('')).toBe(false);
  });
});
