/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useStageRunChips } from './StageRunChipsProvider';

export function OldRunChip({ runId }: { runId: string }) {
  const { visible, latestRunId } = useStageRunChips();
  return visible && latestRunId != null && runId !== latestRunId
    ? <span className="pill pill--gray old-run-chip">old run</span>
    : null;
}
