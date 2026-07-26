/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { TestResult } from '../../pipeline/report';
import type { AccessibilityCompareResult } from '../stages/accessibility';
import type { PerfArtifact } from '../stages/perf';
import type { VisregResult } from '../stages/visreg';
import { TestResultsModel } from './models';
import type {
  BisectCategory,
  BisectTarget,
  TargetKey,
  TargetEvaluationAtCommit,
} from './types';

export interface AnalyzeInput {
  readonly testResults: readonly TestResult[];
  readonly commitSha?: string;
}

interface DiscoveredTarget extends TargetKey {}

interface CategoryAnalyzer {
  readonly category: BisectCategory;
  discover(input: AnalyzeInput): DiscoveredTarget[];
  evaluateTargetsAtCommit(
    input: AnalyzeInput,
    targets: readonly BisectTarget[],
  ): TargetEvaluationAtCommit[];
}

export function assertNoPipelineErrors(
  testResults: readonly TestResult[],
  commitSha: string,
): void {
  for (const test of testResults) {
    const outcome = test.outcomes.find((candidate) => candidate.kind === 'error');
    if (!outcome) continue;
    throw new Error(
      `Candidate ${commitSha} has an error outcome for ${outcome.stage} in ${test.name}: ` +
      `${outcome.error?.message ?? 'unknown pipeline error'}`,
    );
  }
}

export function discoverTargets(
  testResults: readonly TestResult[],
  selectedCategories: readonly BisectCategory[] = categoryAnalyzers.map((analyzer) => analyzer.category),
): BisectTarget[] {
  const input = { testResults };
  const targets = new Map<string, BisectTarget>();
  const selected = new Set(selectedCategories);
  for (const analyzer of categoryAnalyzers.filter((candidate) => selected.has(candidate.category))) {
    for (const target of analyzer.discover(input)) {
      targets.set(target.id, {
        ...target,
        status: 'active',
        recordedTargetEvaluations: {},
      });
    }
  }
  return [...targets.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function evaluateTargetsAtCommitFromTestResults(
  testResults: readonly TestResult[],
  targets: readonly BisectTarget[],
  commitSha: string,
): TargetEvaluationAtCommit[] {
  const input = { testResults, commitSha };
  return categoryAnalyzers.flatMap((analyzer) => analyzer.evaluateTargetsAtCommit(
    input,
    targets.filter((target) => target.category === analyzer.category),
  )).sort((left, right) => left.targetId.localeCompare(right.targetId));
}

const visregAnalyzer: CategoryAnalyzer = {
  category: 'visreg',
  discover(input) {
    return new TestResultsModel(input.testResults)
      .successfulMeasurementsForStage('visreg', isVisregResult)
      .flatMap(({ test, viewport, measurement }) => measurement
        .filter((artifact) => artifact.diffImage !== null)
        .map((artifact) => targetKey('visreg', test, viewport, artifact.selector)));
  },
  evaluateTargetsAtCommit(input, targets) {
    return targets.map((target) => {
      const results = new TestResultsModel(input.testResults)
        .successfulMeasurementsForStage('visreg', isVisregResult)
        .filter((entry) => entry.matchesTarget(target));
      assertMeasurementsExistForTarget(results, target);
      const artifacts = results
        .flatMap((entry) => entry.measurement.filter((artifact) => artifact.selector === target.subject));
      const artifact = artifacts[0];
      return createTargetEvaluationAtCommit(
        target,
        input.commitSha!,
        artifacts.some((item) => item.diffImage !== null),
        artifact ? {
          misMatchPercentage: artifact.misMatchPercentage,
          diffPixels: artifact.diffPixels,
          threshold: artifact.threshold,
          savedByRetries: artifact.savedByRetries,
        } : {},
        artifact ? strings([artifact.controlImage, artifact.experimentImage, artifact.diffImage]) : [],
      );
    });
  },
};

const perfAnalyzer: CategoryAnalyzer = {
  category: 'perf',
  discover(input) {
    return new TestResultsModel(input.testResults)
      .successfulMeasurementsForStage('perf', isPerfArtifact)
      .flatMap(({ test, viewport, measurement }) => (measurement.metrics ?? [])
        .filter((metric) => metric.direction === 'regression')
        .map((metric) => targetKey('perf', test, viewport, metric.label)));
  },
  evaluateTargetsAtCommit(input, targets) {
    return targets.map((target) => {
      const results = new TestResultsModel(input.testResults)
        .successfulMeasurementsForStage('perf', isPerfArtifact)
        .filter((entry) => entry.matchesTarget(target));
      assertMeasurementsExistForTarget(results, target);
      const metrics = results
        .flatMap((entry) => (entry.measurement.metrics ?? []).filter((metric) => metric.label === target.subject));
      const metric = metrics[0];
      return createTargetEvaluationAtCommit(target, input.commitSha!, metrics.some((item) => (
        item.direction === 'regression'
      )), metric ? {
        controlValue: metric.controlValue,
        experimentValue: metric.experimentValue,
        deltaValue: metric.deltaValue,
        controlDisplay: metric.controlDisplay,
        experimentDisplay: metric.experimentDisplay,
        deltaDisplay: metric.deltaDisplay,
        percentDisplay: metric.percentDisplay,
        deltaPercent: metric.deltaPercent,
        pValue: metric.pValue,
        direction: metric.direction,
      } : {}, []);
    });
  },
};

const accessibilityAnalyzer: CategoryAnalyzer = {
  category: 'accessibility',
  discover(input) {
    return new TestResultsModel(input.testResults)
      .successfulMeasurementsForStage('accessibility', isAccessibilityCompareResult)
      .flatMap(({ test, viewport, measurement }) => unique(
        measurement.findings
          .filter((finding) => finding.status === 'new')
          .map((finding) => finding.ruleId),
      ).map((ruleId) => targetKey('accessibility', test, viewport, ruleId)));
  },
  evaluateTargetsAtCommit(input, targets) {
    return targets.map((target) => {
      const results = new TestResultsModel(input.testResults)
        .successfulMeasurementsForStage('accessibility', isAccessibilityCompareResult)
        .filter((entry) => entry.matchesTarget(target));
      assertMeasurementsExistForTarget(results, target);
      const findings = results.flatMap(({ measurement }) => measurement.findings
        .filter((finding) => finding.ruleId === target.subject));
      return createTargetEvaluationAtCommit(target, input.commitSha!, findings.some((finding) => (
        finding.status === 'new'
      )), {
        controlViolationCount: findings.filter((finding) => finding.control).length,
        controlNodeCount: findings.reduce((count, finding) => count + (finding.control?.nodes.length ?? 0), 0),
        experimentViolationCount: findings.filter((finding) => finding.experiment).length,
        experimentNodeCount: findings.reduce((count, finding) => count + (finding.experiment?.nodes.length ?? 0), 0),
        impact: findings[0]?.impact ?? null,
      }, unique(results.flatMap(({ measurement }) => strings([
        measurement.comparisonArtifactHref,
        measurement.control.rawArtifactHref,
        measurement.experiment.rawArtifactHref,
      ]))));
    });
  },
};

const categoryAnalyzers: readonly CategoryAnalyzer[] = [
  visregAnalyzer,
  perfAnalyzer,
  accessibilityAnalyzer,
];

function targetKey(
  category: BisectCategory,
  test: TestResult,
  viewport: string,
  subject: string,
): DiscoveredTarget {
  const target = {
    category,
    testFile: test.filePath,
    testName: test.name,
    viewport,
    subject,
  };
  return { id: JSON.stringify([category, test.filePath, test.name, viewport, subject]), ...target };
}

function createTargetEvaluationAtCommit(
  target: BisectTarget,
  commitSha: string,
  regressionDetected: boolean,
  evidence: TargetEvaluationAtCommit['evidence'],
  evidenceArtifacts: string[],
): TargetEvaluationAtCommit {
  return { targetId: target.id, commitSha, regressionDetected, evidence, evidenceArtifacts };
}

function assertMeasurementsExistForTarget(
  results: readonly unknown[],
  target: BisectTarget,
): void {
  if (results.length > 0) return;
  throw new Error(
    `Missing ${target.category} measurement for ${target.testName} ` +
      `(${target.viewport}, ${target.subject})`,
  );
}

function isVisregResult(measurement: unknown): measurement is VisregResult {
  return Array.isArray(measurement);
}

function isPerfArtifact(measurement: unknown): measurement is PerfArtifact {
  return isRecord(measurement) && (measurement.metrics === undefined || Array.isArray(measurement.metrics));
}

function isAccessibilityCompareResult(measurement: unknown): measurement is AccessibilityCompareResult {
  return isRecord(measurement) && Array.isArray(measurement.findings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function strings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
