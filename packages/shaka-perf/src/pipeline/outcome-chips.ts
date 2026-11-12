/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import type { Stage } from '../stage/stage';
import type { ChipDescriptor, ReportOutcome } from './report';
import { retryUsageTooltip } from './retry-usage-tooltip';

export function brokenChip(outcomes: readonly ReportOutcome[], stages: readonly Pick<Stage, 'name' | 'label'>[]): ChipDescriptor {
  const failedTasks = outcomes.filter((outcome) => outcome.kind === 'error');
  const usage = failedTasks.map((outcome) => ({
    stage: stages.find((stage) => stage.name === outcome.stage)?.label ?? outcome.stage,
    viewport: outcome.viewport.label,
    count: outcome.runMetadata?.taskRetries,
    limit: outcome.runMetadata?.taskRetryLimit,
  }));
  const tooltip = retryUsageTooltip('Tasks still failed', 'retries', usage);
  return { tag: 'broken', text: 'broken', color: 'red', sortingWeight: 0, tooltip };
}

/** Task recovery is separate from screenshots matching after visual retries. */
export function flakyChip(recovered: readonly ReportOutcome[]): ChipDescriptor {
  let retries: number | undefined = 0;
  for (const outcome of recovered) {
    const count = outcome.runMetadata?.taskRetries;
    if (count === undefined || count < 1) {
      retries = undefined;
      break;
    }
    retries += count;
  }
  return {
    tag: 'flaky',
    text: `flaky (recovered after ${retryCountText(retries)})`,
    color: 'yellow',
    sortingWeight: 16,
    affectsCardOrder: false,
    tooltip: 'A task failed, then succeeded on retry.',
  };
}

export function retryCountText(count: number | undefined): string {
  if (count === undefined) return 'retries';
  return `${count} ${count === 1 ? 'retry' : 'retries'}`;
}
