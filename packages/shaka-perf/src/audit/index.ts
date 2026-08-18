/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export { createAuditCommand } from './program';
export type { CreateAuditCommandOptions } from './program';
export { auditPipelineMetadata, createAuditPipeline } from './pipeline';
export type { AuditPipelineConfig } from './pipeline';
export type {
  AuditMetric,
  AuditResult,
  AuditStageConfig,
} from './stages/audit';
export type {
  AccessibilityResult,
  AccessibilityScan,
  AccessibilityStageConfig,
  AccessibilityViolation,
  AccessibilityViolationNode,
} from './stages/accessibility';
export { CodeCoverageStage } from './stages/code_coverage';
export type { CodeCoverageResult } from './stages/code_coverage';
export { AgentReadinessStage } from './stages/agent_readiness';
export type {
  AgentReadinessResult,
  AgentReadinessStageConfig,
  PageSignals,
} from './stages/agent_readiness';
