/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { executionFixture } from '../../pipeline/__tests__/fixtures/execution';
import type { VisregArtifact, VisregResult } from '../stages/visreg';
import type { ChipStageResults } from '../../pipeline/pipeline';
import { unstableVisregChip, visualChangeChip } from '../compare-pipeline';

function artifact(selector: string, overrides: Partial<VisregArtifact> = {}): VisregArtifact {
  return {
    selector, controlImage: '', experimentImage: '', diffImage: null,
    misMatchPercentage: 0, diffPixels: 0, threshold: 0, diffBbox: null,
    savedByRetries: true, visualComparisonCount: 2, visualComparisonLimit: 3, ...overrides,
  };
}

function entries(measurement: VisregResult): ChipStageResults<VisregResult> {
  return [{
    stage: 'visreg',  measurement,
    outcome: { ...executionFixture(), kind: 'ok', stage: 'visreg', measurement },
  }];
}

it('counts shared retries once and excludes selectors that kept differing', () => {
  const result = entries([
    artifact('header'), artifact('footer'),
    artifact('main', { diffImage: 'diff.png', savedByRetries: false, visualComparisonCount: 3 }),
  ]);
  expect(unstableVisregChip(result)?.text).toBe('visreg unstable (matched after 1 retry)');
  expect(visualChangeChip(result)?.tooltip).toBe('Screenshots still differ after 3 of 3 allowed comparisons.');
});

it('scopes differing attempt counts to their selectors', () => {
  const result = entries([
    artifact('header', { diffImage: 'header.png', savedByRetries: false, visualComparisonCount: 2 }),
    artifact('footer', { diffImage: 'footer.png', savedByRetries: false, visualComparisonCount: 3 }),
  ]);
  expect(visualChangeChip(result)?.tooltip).toContain('desktop · header — 2 of 3 comparisons used');
  expect(visualChangeChip(result)?.tooltip).toContain('desktop · footer — 3 of 3 comparisons used');
  expect(unstableVisregChip(result)).toBeNull();
});

it('keeps legacy retry counts unknown instead of substituting viewport totals', () => {
  const result = entries([artifact('document', { visualComparisonCount: undefined })]);
  expect(unstableVisregChip(result)?.text).toBe('visreg unstable (matched after retries)');
});
