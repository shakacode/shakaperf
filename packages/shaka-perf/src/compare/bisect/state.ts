/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { TestResult } from '../../pipeline/report';
import type {
  BisectCategory,
  BisectCompatibility,
  BisectSessionV2,
  BisectTestSelection,
  PersistedRebuildStrategy,
} from './types';

const testSelectionSchema = z.object({
  testFile: z.string(),
  testName: z.string(),
}).strict();

const observationValueSchema = z.union([
  z.string(), z.number(), z.boolean(), z.null(),
]);

const targetObservationSchema = z.object({
  targetId: z.string(),
  commitSha: z.string(),
  present: z.boolean(),
  values: z.record(z.string(), observationValueSchema),
  artifacts: z.array(z.string()),
}).strict();

const targetSchema = z.object({
  id: z.string(),
  category: z.enum(['visreg', 'perf', 'accessibility']),
  testFile: z.string(),
  testName: z.string(),
  viewport: z.string(),
  subject: z.string(),
  status: z.enum(['active', 'found', 'invalid']),
  goodIndex: z.number().int(),
  badIndex: z.number().int(),
  firstBadSha: z.string().optional(),
  invalidReason: z.string().optional(),
  observations: z.record(z.string(), targetObservationSchema),
}).strict();

const attemptSchema = z.object({
  id: z.string(),
  sha: z.string(),
  status: z.enum(['running', 'complete', 'incomplete']),
  requestedCategories: z.array(z.enum(['visreg', 'perf', 'accessibility'])),
  requestedTests: z.array(testSelectionSchema),
  refreshMode: z.enum(['commands', 'container']),
  usedFallback: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  compareResultsPath: z.string().optional(),
  error: z.string().optional(),
}).strict();

const phaseSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'running', 'complete', 'failed']),
  goodSha: z.string(),
  badSha: z.string(),
  orderedCommits: z.array(z.string()),
  commitSubjects: z.record(z.string(), z.string()),
  commitParents: z.record(z.string(), z.array(z.string())),
  targets: z.array(targetSchema),
  attempts: z.array(attemptSchema),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
}).strict();

const rebuildStrategySchema = z.object({
  mode: z.enum(['commands', 'container']),
  commands: z.array(z.string()),
}).strict();

const compatibilitySchema = z.object({
  configFingerprint: z.string(),
  categoriesFingerprint: z.string(),
  testsFingerprint: z.string(),
  rebuildFingerprint: z.string(),
  rangeFingerprint: z.string(),
  effective: z.object({
    config: z.unknown(),
    categories: z.array(z.enum(['visreg', 'perf', 'accessibility'])),
    tests: z.array(testSelectionSchema),
    rebuildStrategy: rebuildStrategySchema,
    range: z.object({ goodSha: z.string(), badSha: z.string() }).strict(),
  }).strict(),
}).strict();

const mergeTargetResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('merge-uninvestigated') }).strict(),
  z.object({ kind: z.literal('merge-introduced') }).strict(),
  z.object({ kind: z.literal('source-found'), sourceSha: z.string() }).strict(),
  z.object({ kind: z.literal('nested-merge'), sourceSha: z.string() }).strict(),
  z.object({ kind: z.literal('octopus-unsupported') }).strict(),
]);

const mergeInvestigationSchema = z.object({
  mergeSha: z.string(),
  parents: z.array(z.string()),
  status: z.enum([
    'merge-uninvestigated', 'running', 'complete', 'octopus-unsupported', 'failed',
  ]),
  targetIds: z.array(z.string()),
  phase: phaseSchema.optional(),
  targetResults: z.record(z.string(), mergeTargetResultSchema),
}).strict();

const sessionSchema = z.object({
  version: z.literal(2),
  status: z.enum(['running', 'complete', 'interrupted', 'failed']),
  mode: z.enum(['primary', 'merge-investigation', 'complete']),
  identity: z.object({
    controlRoot: z.string(),
    experimentRoot: z.string(),
    controlGitCommonDir: z.string(),
    experimentGitCommonDir: z.string(),
    controlOrigin: z.string().nullable(),
    experimentOrigin: z.string().nullable(),
  }).strict(),
  compatibility: compatibilitySchema,
  originalExperiment: z.object({ sha: z.string(), branch: z.string().nullable() }).strict(),
  control: z.object({ sha: z.string(), branch: z.string().nullable() }).strict(),
  rebuildStrategy: rebuildStrategySchema,
  reportInput: z.object({ filename: z.string(), sha256: z.string() }).strict(),
  primary: phaseSchema,
  mergeQueue: z.array(z.string()),
  mergeInvestigations: z.record(z.string(), mergeInvestigationSchema),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  failure: z.string().optional(),
}).strict();

const reportTestSchema = z.object({
  id: z.string(),
  name: z.string(),
  filePath: z.string(),
}).passthrough();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export interface BuildCompatibilityInput {
  config: unknown;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
  rebuildStrategy: PersistedRebuildStrategy;
  range: { goodSha: string; badSha: string };
}

export function buildCompatibility(input: BuildCompatibilityInput): BisectCompatibility {
  const categories = [...input.categories].sort();
  const tests = [...input.tests].sort((left, right) => (
    left.testFile.localeCompare(right.testFile) || left.testName.localeCompare(right.testName)
  ));
  const effective = {
    config: input.config,
    categories,
    tests,
    rebuildStrategy: input.rebuildStrategy,
    range: input.range,
  };
  return {
    configFingerprint: fingerprint(input.config),
    categoriesFingerprint: fingerprint(categories),
    testsFingerprint: fingerprint(tests),
    rebuildFingerprint: fingerprint(input.rebuildStrategy),
    rangeFingerprint: fingerprint(input.range),
    effective,
  };
}

const compatibilityFields: Array<{
  key: keyof Omit<BisectCompatibility, 'effective'>;
  message: string;
}> = [
  { key: 'configFingerprint', message: 'configuration changed' },
  { key: 'categoriesFingerprint', message: 'selected categories changed' },
  { key: 'testsFingerprint', message: 'frozen AB tests changed' },
  { key: 'rebuildFingerprint', message: 'rebuild strategy changed' },
  { key: 'rangeFingerprint', message: 'resolved Git range changed' },
];

export function assertCompatible(
  saved: BisectCompatibility,
  current: BisectCompatibility,
): void {
  for (const field of compatibilityFields) {
    if (saved[field.key] !== current[field.key]) {
      throw new Error(`Cannot resume compare bisect: ${field.message}. Start a fresh run.`);
    }
  }
}

function normalizeCrashedAttempts(session: BisectSessionV2): BisectSessionV2 {
  const normalizePhase = (phase: BisectSessionV2['primary']): BisectSessionV2['primary'] => ({
    ...phase,
    attempts: phase.attempts.map((attempt) => attempt.status === 'running'
      ? {
        ...attempt,
        status: 'incomplete' as const,
        error: 'process stopped before the attempt completed',
      }
      : attempt),
  });
  return {
    ...session,
    primary: normalizePhase(session.primary),
    mergeInvestigations: Object.fromEntries(Object.entries(session.mergeInvestigations)
      .map(([sha, investigation]) => [sha, {
        ...investigation,
        ...(investigation.phase ? { phase: normalizePhase(investigation.phase) } : {}),
      }])),
  };
}

export function parseBisectSession(value: unknown): BisectSessionV2 {
  if (value && typeof value === 'object' && (value as { version?: unknown }).version === 1) {
    throw new Error(
      'Cannot resume compare bisect: session version 1 predates resumable state. Start a fresh run.',
    );
  }
  return normalizeCrashedAttempts(sessionSchema.parse(value) as BisectSessionV2);
}

export function readBisectSession(filePath: string): BisectSessionV2 {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot resume compare bisect: saved session is missing at ${filePath}`);
  }
  return parseBisectSession(JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown);
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

export function writeBadRefTestsAtomic(
  filePath: string,
  tests: readonly TestResult[],
): string {
  const contents = `${JSON.stringify(tests, null, 2)}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, contents, 'utf8');
  fs.renameSync(temporaryPath, filePath);
  return sha256(contents);
}

export function readBadRefTests(filePath: string, expectedSha256: string): TestResult[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot resume compare bisect: persisted bad-ref report input is missing at ${filePath}`);
  }
  const contents = fs.readFileSync(filePath, 'utf8');
  if (sha256(contents) !== expectedSha256) {
    throw new Error('Cannot resume compare bisect: persisted bad-ref report input changed');
  }
  return z.array(reportTestSchema).parse(JSON.parse(contents)) as unknown as TestResult[];
}
