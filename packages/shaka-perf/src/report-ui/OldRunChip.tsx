/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useStageRunChips } from './StageRunChipsProvider';

export function OldRunChip({ latestRun }: { latestRun: boolean }) {
  const visible = useStageRunChips();
  return visible && latestRun === false
    ? <span className="pill pill--gray old-run-chip">old run</span>
    : null;
}
