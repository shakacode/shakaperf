/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { summarizeCoverage } from '../coverage-artifacts';

describe('summarizeCoverage', () => {
  it('counts executed statements and keys them by file:statement', () => {
    const summary = summarizeCoverage({
      '/app/a.js': { s: { 0: 3, 1: 0, 2: 1 } },
      '/app/b.js': { s: { 0: 0 } },
    });
    expect(summary).toEqual({
      files: 2,
      coveredStatements: 2,
      totalStatements: 4,
      statementIds: ['/app/a.js:0', '/app/a.js:2'],
    });
  });

  it('sorts ids so two runs of the same coverage compare equal', () => {
    const summary = summarizeCoverage({ '/b.js': { s: { 1: 1 } }, '/a.js': { s: { 0: 1 } } });
    expect(summary.statementIds).toEqual(['/a.js:0', '/b.js:1']);
  });

  it('skips entries with no statement map rather than throwing on them', () => {
    // The shape comes from whatever instrumented the user's bundle.
    const summary = summarizeCoverage({ '/a.js': { b: {} }, '/b.js': null, '/c.js': { s: { 0: 1 } } });
    expect(summary).toMatchObject({ files: 1, coveredStatements: 1, statementIds: ['/c.js:0'] });
  });
});
