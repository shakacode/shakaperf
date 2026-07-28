/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext, type ReactNode } from 'react';

export type ReportMode = 'full' | 'self-contained';

const ReportModeContext = createContext<ReportMode>('full');

export function ReportModeProvider({ mode, children }: { mode: ReportMode; children: ReactNode }) {
  return <ReportModeContext.Provider value={mode}>{children}</ReportModeContext.Provider>;
}

export function useReportMode(): ReportMode {
  return useContext(ReportModeContext);
}

export function FullReportOnly({ children }: { children: ReactNode }) {
  return useReportMode() === 'full' ? <>{children}</> : null;
}
