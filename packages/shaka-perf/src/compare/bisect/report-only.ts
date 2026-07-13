/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Stage } from '../../stage/stage';
import { buildBisectReportModel, type BisectReportData } from './report-model';
import {
  BISECT_REPORT_DATA_FILENAME,
  writeBisectReport,
} from './report';
import type { BisectSession } from './types';

const categorySchema = z.enum(['visreg', 'perf', 'accessibility']);
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const observationSchema = z.object({
  targetId: z.string(),
  commitSha: z.string(),
  present: z.boolean(),
  values: z.record(z.string(), scalarSchema),
  artifacts: z.array(z.string()),
}).passthrough();
const targetSchema = z.object({
  id: z.string(),
  category: categorySchema,
  testFile: z.string(),
  testName: z.string(),
  viewport: z.string(),
  subject: z.string(),
  status: z.enum(['active', 'found', 'invalid']),
  goodIndex: z.number().int().nonnegative(),
  badIndex: z.number().int().nonnegative(),
  firstBadSha: z.string().optional(),
  invalidReason: z.string().optional(),
  observations: z.record(z.string(), observationSchema),
}).passthrough();
const commitRunSchema = z.object({
  sha: z.string(),
  requestedCategories: z.array(categorySchema),
  refreshMode: z.enum(['commands', 'container']),
  usedFallback: z.boolean(),
  startedAt: z.string(),
}).passthrough();
const sessionSchema = z.object({
  version: z.literal(1),
  status: z.enum(['running', 'complete', 'interrupted', 'failed']),
  goodSha: z.string(),
  badSha: z.string(),
  originalExperiment: z.object({
    sha: z.string(),
    branch: z.string().nullable(),
  }),
  commitSubjects: z.record(z.string(), z.string()).optional(),
  selectedCategories: z.array(categorySchema),
  orderedCommits: z.array(z.string()),
  targets: z.array(targetSchema),
  commitRuns: z.record(z.string(), commitRunSchema),
  startedAt: z.string(),
}).passthrough();
const reportSchema = z.object({
  meta: z.object({}).passthrough(),
  tests: z.array(z.object({
    id: z.string(),
    name: z.string(),
    filePath: z.string(),
  }).passthrough()),
  bisect: z.object({
    status: z.enum(['running', 'complete', 'interrupted', 'failed']),
    goodSha: z.string(),
    badSha: z.string(),
    generatedAt: z.string(),
    commits: z.array(z.unknown()),
    targets: z.array(z.unknown()),
    targetsById: z.record(z.string(), z.unknown()),
    views: z.object({
      unresolved: z.object({ targetIds: z.array(z.string()) }),
      invalid: z.object({ targetIds: z.array(z.string()) }),
    }),
  }).passthrough(),
}).passthrough();

export interface RegenerateBisectReportOptions {
  resultsDirectory: string;
  stages: readonly Stage[];
  now?: string;
}

export interface RegeneratedBisectReport {
  session: BisectSession;
  htmlPath: string;
  dataPath: string;
}

export function regenerateBisectReport(
  options: RegenerateBisectReportOptions,
): RegeneratedBisectReport {
  const sessionPath = path.join(options.resultsDirectory, 'session.json');
  const dataPath = path.join(options.resultsDirectory, BISECT_REPORT_DATA_FILENAME);
  const session = readValidatedJson(sessionPath, sessionSchema) as BisectSession;
  const savedReport = readValidatedJson(dataPath, reportSchema) as unknown as BisectReportData;
  const generatedAt = options.now ?? new Date().toISOString();
  const data: BisectReportData = {
    ...savedReport,
    meta: {
      ...savedReport.meta,
      generatedAt,
      reportOnly: true,
    },
    bisect: buildBisectReportModel(session, savedReport.tests, generatedAt),
  };
  const written = writeBisectReport({
    resultsDirectory: options.resultsDirectory,
    data,
    stages: options.stages,
  });
  return {
    session,
    htmlPath: written.htmlPath,
    dataPath: written.dataPath,
  };
}

function readValidatedJson<T extends z.ZodType>(filePath: string, schema: T): z.infer<T> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${path.basename(filePath)} not found at ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${path.basename(filePath)} is invalid JSON: ${(error as Error).message}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${path.basename(filePath)} is invalid: ${result.error.issues[0]?.message ?? 'schema mismatch'}`);
  }
  return result.data;
}
