/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReactNode } from 'react';
import { useReportMode } from './ReportModeProvider';

export function FullReportOnly({ children }: { children: ReactNode }) {
  return useReportMode() === 'full' ? <>{children}</> : null;
}
