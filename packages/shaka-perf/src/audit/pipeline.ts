/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';
import type { PerfLighthouseConfig } from '../bench/core/lighthouse-config';
import { reportMetaForLighthouseRun } from '../bench/core/lighthouse-config';
import type { Viewport } from '../config';
import {
  createPipeline,
  type ChipStageResults,
  type PipelineMachineReportMeta,
  type PipelineMachineReportRow,
} from '../pipeline/pipeline';
import type { ChipDescriptor, SortDescriptor } from '../pipeline/report';
import { AuditStage, type AuditMetric, type AuditResult } from './stages/audit';
import { AccessibilityStage, type AccessibilityResult, type AccessibilityStageConfig } from './stages/accessibility';
import { AgentReadinessStage, type AgentReadinessStageConfig } from './stages/agent_readiness';
import { CodeCoverageStage, type CodeCoverageResult } from './stages/code_coverage';
import {
  METRIC_LEVEL_CHIP_COLOR,
  classifyMetric,
  combinedBadness,
  worstLevel,
} from './stages/audit/metrics';
import { BuildAnnotatedTimelineStage } from './stages/build_annotated_timeline';
import { AiSummaryStage } from './stages/ai_summary';
import { auditPipelineReport } from './pipeline-report';
import {
  coverageCoversChips,
  coverageDuplicateChips,
  coverageSignaturesByTest,
} from './coverage-duplicate-chips';

export const auditPipelineMetadata = {
  description: 'Run absolute Lighthouse and accessibility audits on the target URL.',
  categories: ['audit', 'accessibility', 'code_coverage'],
  // What `--categories` runs when the user names none. `code_coverage` is left
  // out on purpose: it re-runs every test body in a second browser, so it only
  // runs when asked for by name.
  defaultCategories: ['audit', 'accessibility'],
  stages: ['audit', 'accessibility', 'agent-readiness', 'code_coverage', 'build_annotated_timeline', 'ai_summary'],
} as const;

export interface AuditPipelineConfig {
  readonly parallelism: number;
  readonly lighthouseConfig?: PerfLighthouseConfig;
  readonly accessibility: AccessibilityStageConfig;
  readonly agentReadiness: AgentReadinessStageConfig;
}

export function createAuditPipeline(input: AuditPipelineConfig) {
  return createPipeline({
    name: 'audit',
    description: auditPipelineMetadata.description,
    pipelineConfig: input,
    report: auditPipelineReport,
    // The code_coverage stage mirrors each unit's coverage.json here (see
    // mirrorCoverageToNycOutput); the runner wipes it before a fresh run so
    // orphan slugs from renamed/deleted tests can't pollute the nyc report.
    derivedResultsDirs: ['.nyc_output'],
    machineReportMeta: ({ rows }) => auditMachineReportMeta(input, rows),
  }, (pipeline) => {
    const workerPool = pipeline.registerWorkerPool(input.parallelism);
    pipeline.runStage(workerPool, new AuditStage({
      lighthouseConfig: input.lighthouseConfig,
    }));
    pipeline.runStage(workerPool, new AccessibilityStage(input.accessibility));
    // A second lens beside accessibility: how legible the page is to AI agents /
    // answer engines. OFF by default (opt-in via `config.agentReadiness.enabled`,
    // ideally per-test); when enabled the client report renders the "Agent Ready"
    // tab. Its `applies()` skips units for tests that didn't turn it on.
    pipeline.runStage(workerPool, new AgentReadinessStage(input.agentReadiness));
    // Instrumented-JS coverage + the screenshot-visibility map. Not in the
    // default category set (`--categories code_coverage` runs it): it re-runs
    // every test body in its own visreg-configured browser rather than riding
    // the Lighthouse gather, so it cannot perturb the audit numbers.
    pipeline.runStage(workerPool, new CodeCoverageStage());
    // Reads its frame cap (audit.limitVideoFramesCount) off the per-test
    // effective config at run time — no stage-level config.
    pipeline.runStage(workerPool, new BuildAnnotatedTimelineStage());
    // Registered LAST so it runs after the audit + timeline stages and can
    // review their results; its renderingPriority floats it to the top of the
    // card (runs last, renders first).
    pipeline.runStage(workerPool, new AiSummaryStage());
    pipeline.waitForAllTasksFinishAndDispose(workerPool);

    pipeline.buildChips<{
      audit: AuditResult;
      accessibility: AccessibilityResult;
      code_coverage: CodeCoverageResult;
    }>({
      chipsForAllTests(perTest, context) {
        const out = new Map<AbTestDefinition, readonly ChipDescriptor[]>();
        // Index test → metrics once and reuse across the chip builders below.
        const indexed = perTest.map((entry) => ({
          test: entry.test,
          metrics: collectMetrics(entry.results.audit ?? []),
          accessibilityResults: entry.results.accessibility ?? [],
        }));

        // Coverage-duplicate detection runs across the same `perTest` set
        // because it needs every test's signature to spot supersets. Tests
        // without coverage data — every test when the code_coverage stage is
        // off — are simply absent from the chip map.
        const signatures = coverageSignaturesByTest(
          perTest.map(({ test, results }) => ({
            test,
            coverageResults: results.code_coverage ?? [],
          })),
          context?.readJsonArtifact,
        );
        const duplicateChips = coverageDuplicateChips(signatures);
        const coversChips = coverageCoversChips(signatures);

        for (const { test, metrics, accessibilityResults } of indexed) {
          const duplicateChip = duplicateChips.get(test);
          const coversChip = coversChips.get(test);
          const accessibility = accessibilityChips(accessibilityResults);
          if (metrics.length === 0) {
            const chips: ChipDescriptor[] = [{
              tag: 'no audit',
              text: 'no audit',
              color: 'gray',
              sortingWeight: 50,
              tagHiddenByDefault: true,
              affectsCardOrder: false,
            }];
            chips.push(...accessibility);
            if (duplicateChip) chips.push(duplicateChip);
            if (coversChip) chips.push(coversChip);
            out.set(test, chips);
            continue;
          }
          const chips: ChipDescriptor[] = [
            ...accessibility,
            ...needsImprovementChips(metrics),
            interactionsChip(metrics),
          ];
          if (duplicateChip) chips.push(duplicateChip);
          if (coversChip) chips.push(coversChip);
          out.set(test, chips);
        }
        return out;
      },
    });

    // Sort chips: one dimension per audit metric, so the report shell can
    // order cards by any metric. Mirrors `buildChips` — the framework calls
    // `pipeline.sortsForAllTests` polymorphically; no name switch anywhere.
    pipeline.buildSorts<{ audit: AuditResult }>({
      sortsForAllTests(perTest) {
        const out = new Map<AbTestDefinition, readonly SortDescriptor[]>();
        for (const { test, results } of perTest) {
          // A test may report a metric across several viewports; collapse to a
          // single value per dimension by keeping the worst one.
          const worstByLabel = new Map<string, AuditMetric>();
          for (const metric of collectMetrics(results.audit ?? [])) {
            if (!Number.isFinite(metric.value)) continue;
            const prev = worstByLabel.get(metric.label);
            if (!prev || isWorseMetric(metric.label, metric.value, prev.value)) {
              worstByLabel.set(metric.label, metric);
            }
          }
          const sorts: SortDescriptor[] = [...worstByLabel.values()].map((metric) => ({
            tag: metric.label,
            label: metric.label,
            value: metric.value,
            display: metric.display,
            // Most metrics are higher = worse; LH Score and friends invert it.
            higherIsWorse: !classifyMetric(metric.label).higherIsBetter,
            color: metric.level ? METRIC_LEVEL_CHIP_COLOR[metric.level] : 'gray',
          }));
          if (sorts.length > 0) out.set(test, sorts);
        }
        return out;
      },
    });
  });
}

export function auditMachineReportMeta(
  input: Pick<AuditPipelineConfig, 'lighthouseConfig'>,
  rows: readonly PipelineMachineReportRow[],
): PipelineMachineReportMeta {
  const auditedViewports = rows
    .filter((row) => row.outcomes.some((outcome) => outcome.kind === 'ok' && outcome.stage === 'audit'))
    .map((row) => row.viewport);
  if (auditedViewports.length === 0) return {};
  return reportMetaForLighthouseRun(preferredLighthouseViewport(auditedViewports), input.lighthouseConfig);
}

function preferredLighthouseViewport(viewports: readonly Viewport[]): Viewport | undefined {
  return viewports.find((viewport) => /phone|mobile/i.test(viewport.label)) ?? viewports[0];
}

// "Worse" honours metric direction: for higher-is-better metrics (LH Score)
// the smaller value is worse; for everything else the larger value is worse.
function isWorseMetric(label: string, candidate: number, current: number): boolean {
  return classifyMetric(label).higherIsBetter ? candidate < current : candidate > current;
}

function accessibilityChips(entries: ChipStageResults<AccessibilityResult>): ChipDescriptor[] {
  const total = entries.reduce((sum, entry) => sum + entry.measurement.totalViolations, 0);
  if (total === 0) return [];
  const shouldFail = entries.some((entry) => entry.measurement.failOnViolation);
  return [{
    tag: shouldFail ? 'accessibility violation' : 'accessibility finding',
    text: `accessibility: ${total} violation${total === 1 ? '' : 's'}`,
    color: shouldFail ? 'red' : 'purple',
    sortingWeight: shouldFail ? 1 : 35,
  }];
}

// Emits one chip per test summarizing its overall vitals health. The
// sortingWeight is `-combinedBadness` so cards with worse vitals float
// to the top of the grid (lower weight = higher priority).
function needsImprovementChips(metrics: readonly AuditMetric[]): ChipDescriptor[] {
  const level = worstLevel(metrics);
  if (level !== 'average' && level !== 'bad') return [];
  const badness = combinedBadness(metrics);
  return [{
    tag: 'needs improvement',
    text: 'needs improvement',
    color: METRIC_LEVEL_CHIP_COLOR[level],
    sortingWeight: -badness,
  }];
}

// Mutually exclusive informational chip: tests where Lighthouse recorded an
// INP measurement got at least one user interaction (the worker only emits
// the `interaction-to-next-paint` phase when inp > 0, see
// bench/core/lighthouse-worker.ts). Useful as a filter when you want to
// focus on interactive vs. load-only flows. Doesn't drive card order.
function interactionsChip(metrics: readonly AuditMetric[]): ChipDescriptor {
  const hasInteractions = metrics.some((m) => m.label === 'interaction-to-next-paint');
  return hasInteractions
    ? {
      tag: 'has interactions',
      text: 'has interactions',
      color: 'gray',
      sortingWeight: 45,
      affectsCardOrder: false,
    }
    : {
      tag: 'no interactions',
      text: 'no interactions',
      color: 'gray',
      sortingWeight: 46,
      affectsCardOrder: false,
    };
}

function collectMetrics(entries: ChipStageResults<AuditResult>): AuditMetric[] {
  const metrics: AuditMetric[] = [];
  for (const entry of entries) {
    for (const metric of entry.measurement.metrics) {
      metrics.push(metric);
    }
  }
  return metrics;
}
