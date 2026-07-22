/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DESKTOP_VIEWPORT, type AbTestDefinition } from 'shaka-shared';
import { ArtifactStore } from '../../../pipeline/artifact-store';
import { loadReusableCompareResults } from '../reuse-results';

describe('reusable compare results', () => {
  let cwd: string;
  let test: AbTestDefinition;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-reuse-'));
    test = {
      name: 'Homepage',
      startingPath: '/',
      file: path.join(cwd, 'tests/homepage.abtest.ts'),
      line: 1,
      testTypes: null,
      testFn: async () => undefined,
    };
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('rehydrates only selected category outcomes from compare-results', () => {
    const resultsRoot = path.join(cwd, 'compare-results');
    const store = new ArtifactStore(resultsRoot);
    store.writeOutcome(test, DESKTOP_VIEWPORT.label, {
      kind: 'ok',
      stage: 'visreg',
      measurement: [{ diffImage: 'diff.png' }],
    });
    store.writeOutcome(test, DESKTOP_VIEWPORT.label, {
      kind: 'ok',
      stage: 'accessibility',
      measurement: { findings: [{ ruleId: 'button-name', status: 'new' }] },
    });

    const result = loadReusableCompareResults({
      cwd,
      tests: [test],
      categories: ['accessibility'],
      controlURL: 'http://control.test',
      experimentURL: 'http://experiment.test',
      viewports: {
        visreg: [DESKTOP_VIEWPORT],
        perf: [DESKTOP_VIEWPORT],
        accessibility: [DESKTOP_VIEWPORT],
      },
    });

    expect(result.compareResultsPath).toBe(resultsRoot);
    expect(result.testResults).toMatchObject([{
      name: 'Homepage',
      filePath: 'tests/homepage.abtest.ts',
      outcomes: [{
        stage: 'accessibility',
        viewport: DESKTOP_VIEWPORT,
      }],
    }]);
  });

  it('fails clearly when a selected category has no reusable outcomes', () => {
    expect(() => loadReusableCompareResults({
      cwd,
      tests: [test],
      categories: ['perf'],
      controlURL: 'http://control.test',
      experimentURL: 'http://experiment.test',
      viewports: {
        visreg: [DESKTOP_VIEWPORT],
        perf: [DESKTOP_VIEWPORT],
        accessibility: [DESKTOP_VIEWPORT],
      },
    })).toThrow(/no persisted perf outcomes.*compare-results/i);
  });
});
