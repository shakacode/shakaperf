/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exactNamesFilter, failedTestNames, resolveRunFilter } from '../retry-failed';

function matches(filter: string, name: string): boolean {
  return filter.split(',').some((pattern) => new RegExp(pattern).test(name));
}

describe('retry-failed', () => {
  let resultsRoot: string;
  beforeEach(() => {
    resultsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-failed-'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    fs.rmSync(resultsRoot, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function writeReport(tests: unknown[]): void {
    fs.writeFileSync(path.join(resultsRoot, 'report.json'), JSON.stringify({ tests }));
  }

  it('picks tests with an error outcome or a failure chip at any viewport, once each', () => {
    expect(failedTestNames([
      { name: 'Passing', chips: [{ tag: 'no change' }], outcomes: [{ kind: 'success' }] },
      { name: 'Errored', chips: [], outcomes: [{ kind: 'error' }] },
      { name: 'Visual', chips: [{ tag: 'visual change' }], outcomes: [{ kind: 'success' }] },
      { name: 'Visual', chips: [{ tag: 'visual change' }], outcomes: [{ kind: 'success' }] },
      { name: 'Phone only', chips: [], outcomes: [{ kind: 'success' }] },
      { name: 'Phone only', chips: [{ tag: 'regression' }], outcomes: [{ kind: 'success' }] },
    ])).toEqual(['Errored', 'Visual', 'Phone only']);
  });

  it('builds a filter that matches exactly the given names, commas and regex characters included', () => {
    const filter = exactNamesFilter(['Cart, empty (guest)', 'Home.page']);
    expect(matches(filter, 'Cart, empty (guest)')).toBe(true);
    expect(matches(filter, 'Home.page')).toBe(true);
    expect(matches(filter, 'Homexpage')).toBe(false);
    expect(matches(filter, 'Cart')).toBe(false);
    expect(matches(filter, 'Home.page 2')).toBe(false);
  });

  it('passes the filter through when the flag is off', () => {
    expect(resolveRunFilter({ retryFailed: false, reportOnly: false, filter: 'Home', resultsRoot }))
      .toEqual({ filter: 'Home' });
  });

  it('replaces --filter with the failed tests of the previous run', () => {
    writeReport([
      { name: 'Home', chips: [], outcomes: [{ kind: 'error' }] },
      { name: 'Cart', chips: [], outcomes: [{ kind: 'success' }] },
    ]);
    const result = resolveRunFilter({ retryFailed: true, reportOnly: false, filter: 'Cart', resultsRoot });
    expect(result).toEqual({ filter: '^Home$' });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('ignoring filter "Cart"'));
  });

  it('reports nothing to retry when the previous run passed', () => {
    writeReport([{ name: 'Home', chips: [], outcomes: [{ kind: 'success' }] }]);
    expect(resolveRunFilter({ retryFailed: true, reportOnly: false, filter: undefined, resultsRoot }))
      .toEqual({ nothingToRetry: true });
  });

  it('fails without a previous report, and with --report-only', () => {
    expect(() => resolveRunFilter({ retryFailed: true, reportOnly: false, filter: undefined, resultsRoot }))
      .toThrow(/no previous run found/);
    expect(() => resolveRunFilter({ retryFailed: true, reportOnly: true, filter: undefined, resultsRoot }))
      .toThrow(/--report-only/);
  });
});
