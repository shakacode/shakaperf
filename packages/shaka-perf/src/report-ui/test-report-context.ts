/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext } from 'react';
import type { TestTarget } from '../pipeline/pipeline';
import type { ReportMeta, TestResult } from '../pipeline/report';

interface TestReportValue {
  meta: ReportMeta;
  test: Pick<TestResult, 'name' | 'filePath' | 'viewportArtifactPaths'>;
  targets: readonly TestTarget[];
}

const TestReportContext = createContext<TestReportValue | null>(null);
export const TestReportProvider = TestReportContext.Provider;

export function useTestReport() {
  const value = useContext(TestReportContext);
  if (value === null) throw new Error('useTestReport must be used inside a TestReportProvider');
  return value;
}
