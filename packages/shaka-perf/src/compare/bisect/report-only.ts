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
  writeBisectReportArtifacts,
} from './report';
import { parseBisectSession } from './state';
import type { BisectSession } from './types';

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
  const session = readValidatedSession(sessionPath);
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
  const written = writeBisectReportArtifacts({
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

function readValidatedSession(filePath: string): BisectSession {
  try {
    return parseBisectSession(readJson(filePath));
  } catch (error) {
    throw new Error(`${path.basename(filePath)} is invalid: ${(error as Error).message}`);
  }
}

function readValidatedJson<T extends z.ZodType>(filePath: string, schema: T): z.infer<T> {
  const parsed = readJson(filePath);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${path.basename(filePath)} is invalid: ${result.error.issues[0]?.message ?? 'schema mismatch'}`);
  }
  return result.data;
}

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${path.basename(filePath)} not found at ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${path.basename(filePath)} is invalid JSON: ${(error as Error).message}`);
  }
  return parsed;
}
