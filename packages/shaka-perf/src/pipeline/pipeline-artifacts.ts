/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReactNode } from 'react';
import type { StageReportContext } from './stage-report-model';
import { createAuditPipeline, type AuditPipelineConfig } from '../audit/pipeline';
import { createComparePipeline, type ComparePipelineConfig } from '../compare/compare-pipeline';
import type { StageCategory, StageName, StageRenderEntry } from '../stage/stage';
import {
  renderPipelineStageArtifacts,
  type Pipeline,
} from './pipeline';
import type { ReportMeta, TestResult } from './report';
import type { StageArtifactTestMeta } from './stage-report-components';

function pipelineForReport(pipelineName: string | undefined, config: unknown): Pipeline {
  switch (pipelineName ?? 'compare') {
    case 'audit':
      return createAuditPipeline(config as AuditPipelineConfig);
    case 'compare':
      return createComparePipeline(config as ComparePipelineConfig);
    default:
      throw new Error(`Unknown pipeline "${pipelineName}"`);
  }
}

/** The report-relevant fields of a pipeline stage. */
export interface ReportStage {
  readonly name: StageName;
  readonly category: StageCategory;
  readonly label: string;
}

/**
 * The pipeline's stages, in pipeline order, carrying each stage's own
 * filter-chip label. The report shell reads `label` straight off the stage
 * instead of hardcoding (or re-deriving) a name→label mapping of its own.
 */
export function pipelineStagesForReport(
  pipelineName: string | undefined,
  config: unknown,
): ReportStage[] {
  return pipelineForReport(pipelineName, config).stages.map((stage) => ({
    name: stage.name,
    category: stage.category,
    label: stage.label,
  }));
}

export function renderPersistedStageArtifacts(
  pipelineName: string | undefined,
  config: unknown,
  name: StageName,
  measurements: readonly StageRenderEntry[],
  context: StageReportContext = { outcomes: [] },
): ReactNode {
  return renderPipelineStageArtifacts(pipelineForReport(pipelineName, config), name, measurements, context);
}

export function renderPersistedStageHeadingBadge(
  pipelineName: string | undefined,
  config: unknown,
  name: StageName,
  measurements: readonly StageRenderEntry[],
): ReactNode {
  const stage = pipelineForReport(pipelineName, config).stages.find((candidate) => candidate.name === name);
  return stage?.renderHeadingBadge?.(measurements);
}

export function renderPipelineHeaderUrls(meta: ReportMeta): ReactNode {
  return pipelineForReport(meta.pipelineName, meta.pipelineConfig).report.renderHeaderUrls(meta);
}

export function renderPipelineTestCardUrls(meta: ReportMeta, test: TestResult, details?: Parameters<Pipeline['report']['renderTestCardUrls']>[1]): ReactNode {
  return pipelineForReport(meta.pipelineName, meta.pipelineConfig).report.renderTestCardUrls(test, details);
}

export function renderPipelineDialogMetaUrls(test: StageArtifactTestMeta): ReactNode {
  return pipelineForReport(test.pipelineName, test.pipelineConfig).report.renderDialogMetaUrls(test);
}

/** One re-run command per viewport; empty when the pipeline has no such command. */
export function pipelineTroubleshootCommands(
  meta: ReportMeta,
  testName: string,
  viewportLabels: readonly string[],
): string[] {
  const build = pipelineForReport(meta.pipelineName, meta.pipelineConfig).report.troubleshootCommand;
  if (!build) return [];
  return viewportLabels.map((label) => build(testName, label));
}

export function pipelineReportLabel(meta: ReportMeta): string {
  return pipelineForReport(meta.pipelineName, meta.pipelineConfig).report.reportLabel;
}
