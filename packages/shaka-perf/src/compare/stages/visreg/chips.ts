/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ChipStageResults } from '../../../pipeline/pipeline';
import type { ChipDescriptor } from '../../../pipeline/report';
import { retryCountText } from '../../../pipeline/outcome-chips';
import { retryUsageTooltip } from '../../../pipeline/retry-usage-tooltip';
import type { VisregArtifact, VisregResult } from '../visreg';

export function visualChangeChip(entries: ChipStageResults<VisregResult>): ChipDescriptor | null {
  const changed = entries.flatMap(({ measurement, viewport }) => measurement
    .filter((artifact) => artifact.diffImage !== null)
    .map((artifact) => ({
      stage: 'Visual comparison',
      viewport: measurement.length > 1 ? `${viewport.label} · ${artifact.selector}` : viewport.label,
      count: artifact.compareAttempts,
      limit: artifact.compareRetries === undefined ? undefined : artifact.compareRetries + 1,
    })));
  if (changed.length === 0) return null;

  return {
    tag: 'visual change',
    text: `visual change: ${changed.length} diff${changed.length === 1 ? '' : 's'}`,
    color: 'red',
    sortingWeight: 10,
    tooltip: retryUsageTooltip('Screenshots still differ', 'attempts', changed),
  };
}

/** Selectors share capture attempts within a viewport; count those retries once. */
function recoveredRetryCount(viewports: readonly VisregArtifact[][]): number | undefined {
  let total = 0;
  for (const selectors of viewports) {
    let viewportRetries = 0;
    for (const artifact of selectors) {
      const attempts = artifact.compareAttempts;
      if (attempts === undefined || attempts < 2) return undefined;
      viewportRetries = Math.max(viewportRetries, attempts - 1);
    }
    total += viewportRetries;
  }
  return total;
}

export function unstableVisregChip(entries: ChipStageResults<VisregResult>): ChipDescriptor | null {
  const recovered = entries
    .map(({ measurement }) => measurement.filter((artifact) => artifact.savedByRetries))
    .filter((selectors) => selectors.length > 0);
  if (recovered.length === 0) return null;

  return {
    tag: 'visreg unstable',
    text: `visreg unstable (matched after ${retryCountText(recoveredRetryCount(recovered))})`,
    color: 'red',
    sortingWeight: 12,
    tooltip: 'Screenshots differed initially, then matched on retry.',
  };
}
