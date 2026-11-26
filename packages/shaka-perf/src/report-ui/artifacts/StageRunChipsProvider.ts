/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext } from 'react';

// Whole-test warnings and bisect reports suppress repeated viewport warnings,
// without changing the freshness metadata supplied to stage renderers.
const StageRunChipsContext = createContext(true);
export const StageRunChipsProvider = StageRunChipsContext.Provider;

export function useStageRunChips() {
  return useContext(StageRunChipsContext);
}
