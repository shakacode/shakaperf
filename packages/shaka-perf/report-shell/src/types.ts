/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export type { TestType } from 'shaka-shared';

import type { ReportData as PipelineReportData } from '../../src/pipeline/report';
import type { BisectReportModel } from '../../src/compare/bisect/report-model';

export type {
  ChipDescriptor,
  ReportMeta,
  ReportOutcome,
  SortDescriptor,
  TestResult,
} from '../../src/pipeline/report';

export type { BisectCategory } from '../../src/compare/bisect/types';
export type {
  BisectReportCommit,
  BisectReportCounts,
  BisectReportData,
  BisectReportModel,
  BisectReportTarget,
  BisectReportView,
} from '../../src/compare/bisect/report-model';

export type ReportData = PipelineReportData & { bisect?: BisectReportModel };
