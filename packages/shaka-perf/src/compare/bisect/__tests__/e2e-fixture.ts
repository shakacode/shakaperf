/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { AbTestsConfig } from '../../../config';
import type { TestResult } from '../../../pipeline/report';
import type { ResolvedConfig } from '../../../twin-servers/types';
import { checkoutDetached, restoreCheckout } from '../git';
import { writeSessionAtomic, writeSummary } from '../persistence';
import type {
  CompareRunRequest,
  ExecuteBisectDependencies,
  RunBisectOptions,
} from '../session';
import { writeBadRefTestsAtomic } from '../state';
import type { BisectCategory } from '../types';

export interface E2eRepositoryFixture {
  rootDir: string;
  sourceDir: string;
  controlDir: string;
  experimentDir: string;
  resultsDirectory: string;
  shas: Record<string, string>;
  experimentBranch: string;
  originalExperimentSha: string;
  runOptions: Omit<RunBisectOptions, 'dependencies'>;
  cleanup(): void;
}

export interface E2eDependencyHarness {
  dependencies: ExecuteBisectDependencies;
  compareCalls: CompareRunRequest[];
}

interface E2eDependencyOptions {
  fixture: E2eRepositoryFixture;
  resultsBySha: Record<string, readonly TestResult[]>;
}

export interface StubRegression {
  id: string;
  category: BisectCategory;
  testFile: string;
  testName: string;
  subject: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitLabel(repoDir: string, label: string): string {
  fs.writeFileSync(path.join(repoDir, 'history.txt'), `${label}\n`, 'utf8');
  git(repoDir, ['add', 'history.txt']);
  git(repoDir, ['commit', '-m', label]);
  return git(repoDir, ['rev-parse', 'HEAD']);
}

export function createLinearFixture(labels: readonly string[]): E2eRepositoryFixture {
  if (labels.length < 2) throw new Error('A bisect fixture requires at least good and bad commits');
  if (new Set(labels).size !== labels.length) throw new Error('Bisect fixture labels must be unique');

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-e2e-'));
  const sourceDir = path.join(rootDir, 'source');
  const controlDir = path.join(rootDir, 'control');
  const experimentDir = path.join(rootDir, 'experiment');
  const resultsDirectory = path.join(rootDir, 'compare-bisect-results');
  fs.mkdirSync(sourceDir);
  git(sourceDir, ['init', '--initial-branch=main']);
  git(sourceDir, ['config', 'user.email', 'bisect-e2e@example.com']);
  git(sourceDir, ['config', 'user.name', 'Bisect E2E']);

  const shas = Object.fromEntries(labels.map((label) => [label, commitLabel(sourceDir, label)]));
  git(rootDir, ['clone', '--quiet', sourceDir, controlDir]);
  git(rootDir, ['clone', '--quiet', sourceDir, experimentDir]);
  git(controlDir, ['checkout', '--quiet', '--detach', shas[labels[0]!]!]);

  const experimentBranch = git(experimentDir, ['branch', '--show-current']);
  const originalExperimentSha = git(experimentDir, ['rev-parse', 'HEAD']);
  const config = {
    bisect: {
      rebuildCommands: [],
      rebuildContainer: false,
    },
  } as unknown as AbTestsConfig;
  const twinServers = {
    controlDir,
    experimentDir,
  } as ResolvedConfig;

  return {
    rootDir,
    sourceDir,
    controlDir,
    experimentDir,
    resultsDirectory,
    shas,
    experimentBranch,
    originalExperimentSha,
    runOptions: {
      cwd: rootDir,
      resultsDirectory,
      config,
      twinServers,
      selectedCategories: ['visreg'],
      frozenTests: [],
      headed: false,
      controlURL: 'http://control.test',
      experimentURL: 'http://experiment.test',
    },
    cleanup() {
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

export function createE2eDependencies(options: E2eDependencyOptions): E2eDependencyHarness {
  const { fixture } = options;
  const compareCalls: CompareRunRequest[] = [];
  let tick = 0;

  return {
    compareCalls,
    dependencies: {
      installSignalHandlers() {
        return () => undefined;
      },
      async beginSession() {},
      async endSession() {},
      checkout: (sha) => checkoutDetached(fixture.experimentDir, sha),
      async materialize() {},
      async refresh() {
        return { mode: 'commands', usedFallback: false };
      },
      async compare(request) {
        compareCalls.push({
          ...request,
          categories: [...request.categories],
          tests: [...request.tests],
        });
        const results = options.resultsBySha[request.sha];
        if (!results) throw new Error(`No stubbed compare results for ${request.sha}`);
        return { testResults: filterCompareResults(results, request) };
      },
      async restore() {
        await restoreCheckout(fixture.experimentDir, {
          branch: fixture.experimentBranch,
          sha: fixture.originalExperimentSha,
        });
      },
      clearSummary() {
        fs.rmSync(path.join(fixture.resultsDirectory, 'summary.json'), { force: true });
      },
      clearPriorReportOutput() {},
      writeSession(session) {
        writeSessionAtomic(path.join(fixture.resultsDirectory, 'session.json'), session);
      },
      writeReport() {},
      writeSummary(session, metadata) {
        writeSummary(path.join(fixture.resultsDirectory, 'summary.json'), session, metadata);
      },
      writeBadRefTests(tests) {
        return writeBadRefTestsAtomic(
          path.join(fixture.resultsDirectory, 'bad-ref-tests.json'),
          tests,
        );
      },
      recordDecision() {},
      logProgress() {},
      now() {
        return new Date(Date.UTC(2026, 6, 19, 0, 0, tick++)).toISOString();
      },
      async reuseCurrentResults(request) {
        const results = options.resultsBySha[request.sha];
        if (!results) throw new Error(`No reusable compare results for ${request.sha}`);
        return { testResults: results };
      },
    },
  };
}

export function visregTimeline(
  fixture: E2eRepositoryFixture,
  states: Record<string, boolean>,
): Record<string, readonly TestResult[]> {
  return Object.fromEntries(Object.entries(states).map(([label, present]) => {
    const sha = fixture.shas[label];
    if (!sha) throw new Error(`Unknown fixture label: ${label}`);
    return [sha, [visregResult(present)]];
  }));
}

export function stubRegression(
  id: string,
  category: BisectCategory,
  options: {
    testFile?: string;
    testName?: string;
    subject?: string;
  } = {},
): StubRegression {
  return {
    id,
    category,
    testFile: options.testFile ?? 'tests/homepage.abtest.ts',
    testName: options.testName ?? 'Homepage',
    subject: options.subject ?? {
      visreg: 'document',
      perf: 'TBT',
      accessibility: 'button-name',
    }[category],
  };
}

export function regressionTimeline(
  fixture: E2eRepositoryFixture,
  targets: readonly StubRegression[],
  presentByLabel: Record<string, readonly string[]>,
): Record<string, readonly TestResult[]> {
  const targetIds = new Set(targets.map((target) => target.id));
  return Object.fromEntries(Object.entries(presentByLabel).map(([label, presentIds]) => {
    const sha = fixture.shas[label];
    if (!sha) throw new Error(`Unknown fixture label: ${label}`);
    for (const id of presentIds) {
      if (!targetIds.has(id)) throw new Error(`Unknown regression target: ${id}`);
    }
    const present = new Set(presentIds);
    const grouped = new Map<string, StubRegression[]>();
    for (const target of targets) {
      const key = JSON.stringify([target.testFile, target.testName]);
      grouped.set(key, [...(grouped.get(key) ?? []), target]);
    }
    return [sha, [...grouped.values()].map((group) => regressionResult(group, present))];
  }));
}

function filterCompareResults(
  results: readonly TestResult[],
  request: CompareRunRequest,
): TestResult[] {
  const requestedTests = new Set(request.tests.map(({ testFile, testName }) => (
    JSON.stringify([testFile, testName])
  )));
  const requestedCategories = new Set(request.categories);
  return results
    .filter((result) => requestedTests.size === 0 || requestedTests.has(JSON.stringify([
      result.filePath,
      result.name,
    ])))
    .map((result) => ({
      ...result,
      outcomes: result.outcomes.filter((outcome) => requestedCategories.has(outcome.stage as BisectCategory)),
    }));
}

function regressionResult(
  targets: readonly StubRegression[],
  present: ReadonlySet<string>,
): TestResult {
  const first = targets[0]!;
  const visualTargets = targets.filter((target) => target.category === 'visreg');
  const perfTargets = targets.filter((target) => target.category === 'perf');
  const accessibilityTargets = targets.filter((target) => target.category === 'accessibility');
  return {
    ...baseResult(first.testFile, first.testName),
    outcomes: [
      ...(visualTargets.length === 0 ? [] : [{
        kind: 'ok' as const,
        stage: 'visreg',
        viewport: DESKTOP_VIEWPORT,
        measurement: visualTargets.map((target) => ({
          selector: target.subject,
          controlImage: `${target.id}-control.png`,
          experimentImage: `${target.id}-experiment.png`,
          diffImage: present.has(target.id) ? `${target.id}-diff.png` : null,
          misMatchPercentage: present.has(target.id) ? 2.5 : 0,
          diffPixels: present.has(target.id) ? 42 : 0,
          threshold: 0.1,
          diffBbox: null,
          savedByRetries: false,
        })),
      }]),
      ...(perfTargets.length === 0 ? [] : [{
        kind: 'ok' as const,
        stage: 'perf',
        viewport: DESKTOP_VIEWPORT,
        measurement: {
          metrics: perfTargets.map((target) => ({
            label: target.subject,
            group: 'vitals',
            controlValue: 100,
            experimentValue: present.has(target.id) ? 120 : 100,
            deltaValue: present.has(target.id) ? 20 : 0,
            controlDisplay: '100ms',
            experimentDisplay: present.has(target.id) ? '120ms' : '100ms',
            deltaDisplay: present.has(target.id) ? '+20ms' : '0ms',
            percentDisplay: present.has(target.id) ? '+20%' : '0%',
            deltaPercent: present.has(target.id) ? 20 : 0,
            pValue: present.has(target.id) ? 0.01 : 1,
            direction: present.has(target.id) ? 'regression' as const : 'none' as const,
          })),
        },
      }]),
      ...(accessibilityTargets.length === 0 ? [] : [{
        kind: 'ok' as const,
        stage: 'accessibility',
        viewport: DESKTOP_VIEWPORT,
        measurement: accessibilityMeasurement(accessibilityTargets, present),
      }]),
    ],
  };
}

function accessibilityMeasurement(
  targets: readonly StubRegression[],
  present: ReadonlySet<string>,
) {
  const findings = targets.filter((target) => present.has(target.id)).map((target) => ({
    status: 'new' as const,
    signature: `${target.subject}|[data-cy="${target.id}"]`,
    ruleId: target.subject,
    impact: 'critical' as const,
    tags: ['wcag2a'],
    experiment: {
      impact: 'critical' as const,
      help: 'Element must be accessible',
      helpUrl: 'https://example.test/accessibility',
      tags: ['wcag2a'],
      nodes: [{
        target: [`[data-cy="${target.id}"]`],
        html: '<button></button>',
        failureSummary: 'Fix the element',
      }],
    },
  }));
  return {
    control: {
      side: 'control' as const,
      url: 'http://control.test/',
      violations: [],
      rawArtifactHref: 'control-accessibility.json',
    },
    experiment: {
      side: 'experiment' as const,
      url: 'http://experiment.test/',
      violations: [],
      rawArtifactHref: 'experiment-accessibility.json',
    },
    effectiveConfig: { tags: [], disableRules: [], includeRules: null },
    failOnViolation: true,
    findings,
    summary: {
      new: findings.length,
      fixed: 0,
      changed: 0,
      unchanged: 0,
      errors: 0,
      blocked: 0,
      newByImpact: findings.length === 0 ? {} : { critical: findings.length },
      fixedByImpact: {},
      changedByImpact: {},
    },
    comparisonArtifactHref: 'accessibility-comparison.html',
  };
}

function baseResult(testFile: string, testName: string): TestResult {
  return {
    id: JSON.stringify([testFile, testName]),
    name: testName,
    filePath: testFile,
    startingPath: '/',
    controlUrl: 'http://control.test/',
    experimentUrl: 'http://experiment.test/',
    code: null,
    chips: [],
    sorts: [],
    durationMs: 0,
    measuredAt: null,
    runId: null,
    viewportArtifactPaths: [],
    outcomes: [],
  };
}

function visregResult(present: boolean): TestResult {
  return {
    ...baseResult('tests/homepage.abtest.ts', 'Homepage'),
    outcomes: [{
      kind: 'ok',
      stage: 'visreg',
      viewport: DESKTOP_VIEWPORT,
      measurement: [{
        selector: 'document',
        controlImage: 'control.png',
        experimentImage: 'experiment.png',
        diffImage: present ? 'diff.png' : null,
        misMatchPercentage: present ? 2.5 : 0,
        diffPixels: present ? 42 : 0,
        threshold: 0.1,
        diffBbox: null,
        savedByRetries: false,
      }],
    }],
  };
}

export function assertExperimentRestored(fixture: E2eRepositoryFixture): void {
  expect(git(fixture.experimentDir, ['branch', '--show-current']))
    .toBe(fixture.experimentBranch);
  expect(git(fixture.experimentDir, ['rev-parse', 'HEAD']))
    .toBe(fixture.originalExperimentSha);
}
