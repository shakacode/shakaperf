/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext } from 'react';
import type { TestTarget } from '../../pipeline/pipeline';
import type { ReportMeta, TestResult } from '../../pipeline/report';

interface TestCardData {
  meta: ReportMeta;
  test: Pick<TestResult, 'name' | 'filePath' | 'viewportArtifactPaths'>;
  targets: readonly TestTarget[];
}

const TestCardContext = createContext<TestCardData | null>(null);
export const TestCardProvider = TestCardContext.Provider;

export function useTestCard() {
  const value = useContext(TestCardContext);
  if (value === null) throw new Error('useTestCard must be used inside a TestCardProvider');
  return value;
}
