import { z } from 'zod';
import type { ReportData } from './types';

const categorySchema = z.enum(['visreg', 'perf', 'accessibility']);
const targetStatusSchema = z.enum(['active', 'found', 'invalid']);
const mergeStatusSchema = z.enum([
  'merge-uninvestigated', 'running', 'complete', 'octopus-unsupported', 'failed',
]);
const mergeResultSchema = z.enum([
  'merge-uninvestigated', 'merge-introduced', 'source-found', 'nested-merge',
  'octopus-unsupported',
]);
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const targetEvaluationAtCommitSchema = z.object({
  evidence: z.record(z.string(), scalarSchema),
}).passthrough();
const targetSchema = z.object({
  id: z.string(),
  category: categorySchema,
  testId: z.string().nullable(),
  testFile: z.string(),
  testName: z.string(),
  viewport: z.string(),
  subject: z.string(),
  status: targetStatusSchema,
  firstBadSha: z.string().optional(),
  invalidReason: z.string().optional(),
  badRefEvaluation: targetEvaluationAtCommitSchema.optional(),
  mainlineFirstBadSha: z.string().optional(),
  mainlineIsMerge: z.boolean().optional(),
  mergeInvestigationStatus: mergeStatusSchema.optional(),
  mergeSourceSha: z.string().optional(),
  mergeResult: mergeResultSchema.optional(),
}).passthrough();
const countsSchema = z.object({
  visreg: z.number(),
  perf: z.number(),
  accessibility: z.number(),
});
const mergeSourceCommitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  measured: z.boolean(),
  isMerge: z.boolean(),
  counts: countsSchema,
  targetIds: z.array(z.string()),
});
const mergeInvestigationSchema = z.object({
  status: mergeStatusSchema,
  failure: z.string().optional(),
  mergeBase: z.string().optional(),
  secondParent: z.string().optional(),
  sourceCommits: z.array(mergeSourceCommitSchema),
  mergeIntroducedTargetIds: z.array(z.string()),
});
const commitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  position: z.number(),
  measured: z.boolean(),
  counts: countsSchema,
  targetIds: z.array(z.string()),
  isMerge: z.boolean().optional(),
  mergeInvestigationStatus: mergeStatusSchema.optional(),
  mergeInvestigation: mergeInvestigationSchema.optional(),
}).passthrough();
const viewSchema = z.object({ targetIds: z.array(z.string()) });
const bisectSchema = z.object({
  status: z.enum(['running', 'complete', 'interrupted', 'failed']),
  goodSha: z.string(),
  badSha: z.string(),
  generatedAt: z.string(),
  commits: z.array(commitSchema),
  targets: z.array(targetSchema),
  targetsById: z.record(z.string(), targetSchema),
  views: z.object({
    unresolved: viewSchema,
    invalid: viewSchema,
  }),
}).passthrough();
const reportDataSchema = z.object({
  meta: z.object({}).passthrough(),
  tests: z.array(z.unknown()),
  bisect: bisectSchema.optional(),
}).passthrough();

export function parseReportData(text: string): ReportData | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return reportDataSchema.safeParse(parsed).success ? parsed as ReportData : null;
  } catch {
    return null;
  }
}
