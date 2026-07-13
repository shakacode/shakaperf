/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { renderReportHtml, reportDataForMode } from '../../pipeline/report';
import type { Stage } from '../../stage/stage';
import type { BisectReportData } from './report-model';

export const BISECT_REPORT_FILENAME = 'bisect-report.html';

export interface WriteBisectReportOptions {
  resultsDirectory: string;
  data: BisectReportData;
  stages: readonly Stage[];
}

export function writeBisectReport(options: WriteBisectReportOptions): string {
  const outputPath = path.resolve(options.resultsDirectory, BISECT_REPORT_FILENAME);
  const portable = reportDataForMode(
    { ...options.data, meta: { ...options.data.meta, reportMode: 'lightweight' } },
    'lightweight',
    options.stages,
  );
  fs.mkdirSync(options.resultsDirectory, { recursive: true });
  fs.writeFileSync(outputPath, renderReportHtml(portable), 'utf8');
  return outputPath;
}
