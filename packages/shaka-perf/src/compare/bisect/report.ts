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
export const BISECT_REPORT_DATA_FILENAME = 'bisect-report.json';

export interface WriteBisectReportOptions {
  resultsDirectory: string;
  data: BisectReportData;
  stages: readonly Stage[];
}

export interface WrittenBisectReport {
  htmlPath: string;
  dataPath: string;
  data: BisectReportData;
}

export function clearPriorBisectReportOutput(resultsDirectory: string): void {
  fs.rmSync(path.join(resultsDirectory, BISECT_REPORT_FILENAME), { force: true });
  fs.rmSync(path.join(resultsDirectory, BISECT_REPORT_DATA_FILENAME), { force: true });
}

export function writeBisectReport(options: WriteBisectReportOptions): string {
  return writeBisectReportArtifacts(options).htmlPath;
}

export function writeBisectReportArtifacts(options: WriteBisectReportOptions): WrittenBisectReport {
  const htmlPath = path.resolve(options.resultsDirectory, BISECT_REPORT_FILENAME);
  const dataPath = path.resolve(options.resultsDirectory, BISECT_REPORT_DATA_FILENAME);
  const portable = reportDataForMode(
    { ...options.data, meta: { ...options.data.meta, reportMode: 'lightweight' } },
    'lightweight',
    options.stages,
  ) as BisectReportData;
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  writeFileAtomic(dataPath, `${JSON.stringify(portable, null, 2)}\n`);
  writeFileAtomic(htmlPath, renderReportHtml(portable));
  return { htmlPath, dataPath, data: portable };
}

function writeFileAtomic(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}
