/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext } from 'react';

const StageRunChipsContext = createContext<{
  visible: boolean;
  latestRunId: string | null;
}>({ visible: false, latestRunId: null });
export const StageRunChipsProvider = StageRunChipsContext.Provider;

export function useStageRunChips() {
  return useContext(StageRunChipsContext);
}
