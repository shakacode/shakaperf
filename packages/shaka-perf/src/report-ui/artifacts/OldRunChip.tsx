/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext } from 'react';

const OldRunChipContext = createContext<string | null>(null);
export const OldRunChipProvider = OldRunChipContext.Provider;

export function OldRunChip({ runId }: { runId: string }) {
  const latestRunId = useContext(OldRunChipContext);
  return latestRunId !== null && runId !== latestRunId
    ? <span className="pill pill--gray old-run-chip">old run</span>
    : null;
}
