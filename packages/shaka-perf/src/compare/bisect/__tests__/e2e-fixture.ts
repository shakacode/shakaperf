/*
 * Copyright (c) 2026 ShakaCode LLC.
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
import {
  ExactCheckout,
  markNativeBisect,
  resetNativeBisect,
  restoreCheckout,
  startNativeBisect,
  NativeGitBisectDriver,
} from '../git';
import { writeSessionAtomic, writeSummary } from '../persistence';
import type {
  CompareRunRequest,
  ExecuteBisectDependencies,
  ExperimentReloadRequest,
  RunBisectOptions,
} from '../session';
import { parseBisectSession, writeBadRefTestsAtomic } from '../state';
import type { BisectCategory, BisectSession } from '../types';

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
  candidateComparisonCalls: CompareRunRequest[];
  experimentReloadCalls: ExperimentReloadRequest[];
}

interface E2eDependencyOptions {
  fixture: E2eRepositoryFixture;
  resultsBySha: Record<string, readonly TestResult[]>;
  failAtSha?: string;
  containerFallbackAtSha?: string;
}

export interface StubRegression {
  id: string;
  category: BisectCategory;
  testFile: string;
  testName: string;
  subject: string;
}

export interface ExpectedFirstBadCommit {
  regression: StubRegression;
  commit: string;
}

export interface ExpectedMergeAttribution {
  regression: StubRegression;
  sourceCommit: string | null;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitLabel(repoDir: string, label: string): string {
  const filename = `${label.replace(/[^a-zA-Z0-9_-]/g, '-')}.txt`;
  fs.writeFileSync(path.join(repoDir, filename), `${label}\n`, 'utf8');
  git(repoDir, ['add', filename]);
  git(repoDir, ['commit', '-m', label]);
  return git(repoDir, ['rev-parse', 'HEAD']);
}

export function createLinearFixture(labels: readonly string[]): E2eRepositoryFixture {
  if (labels.length < 2) {
    throw new Error('A bisect fixture requires at least good and bad commits');
  }
  if (new Set(labels).size !== labels.length) {
    throw new Error('Bisect fixture labels must be unique');
  }

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-e2e-'));
  const sourceDir = path.join(rootDir, 'source');
  fs.mkdirSync(sourceDir);
  git(sourceDir, ['init', '--initial-branch=main']);
  git(sourceDir, ['config', 'user.email', 'bisect-e2e@example.com']);
  git(sourceDir, ['config', 'user.name', 'Bisect E2E']);

  const shas = Object.fromEntries(labels.map((label) => [label, commitLabel(sourceDir, label)]));
  return finishFixture(rootDir, sourceDir, shas, labels[0]!, labels.at(-1)!);
}

export function createMergeFixture(
  afterMergeLabels: readonly string[],
  beforeMergeLabels: readonly string[] = [],
): E2eRepositoryFixture {
  const reservedLabels = [
    'known-good',
    'topic-first-commit',
    'topic-second-commit',
    'mainline-before-merge',
    'merge-topic-branch',
  ];
  const allLabels = [...reservedLabels, ...beforeMergeLabels, ...afterMergeLabels];
  if (afterMergeLabels.length === 0) {
    throw new Error('A merge fixture requires a bad commit after the merge commit');
  }
  if (new Set(allLabels).size !== allLabels.length) {
    throw new Error('Merge fixture labels must be unique');
  }

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-e2e-'));
  const sourceDir = path.join(rootDir, 'source');
  fs.mkdirSync(sourceDir);
  git(sourceDir, ['init', '--initial-branch=main']);
  git(sourceDir, ['config', 'user.email', 'bisect-e2e@example.com']);
  git(sourceDir, ['config', 'user.name', 'Bisect E2E']);

  const shas: Record<string, string> = {};
  shas['known-good'] = commitLabel(sourceDir, 'known-good');
  git(sourceDir, ['checkout', '--quiet', '-b', 'topic']);
  shas['topic-first-commit'] = commitLabel(sourceDir, 'topic-first-commit');
  shas['topic-second-commit'] = commitLabel(sourceDir, 'topic-second-commit');
  git(sourceDir, ['checkout', '--quiet', 'main']);
  for (const label of beforeMergeLabels) {
    shas[label] = commitLabel(sourceDir, label);
  }
  shas['mainline-before-merge'] = commitLabel(sourceDir, 'mainline-before-merge');
  git(sourceDir, ['merge', '--quiet', '--no-ff', 'topic', '-m', 'merge-topic-branch']);
  shas['merge-topic-branch'] = git(sourceDir, ['rev-parse', 'HEAD']);
  for (const label of afterMergeLabels) {
    shas[label] = commitLabel(sourceDir, label);
  }

  return finishFixture(rootDir, sourceDir, shas, 'known-good', afterMergeLabels.at(-1)!);
}

function finishFixture(
  rootDir: string,
  sourceDir: string,
  shas: Record<string, string>,
  goodLabel: string,
  badLabel: string,
): E2eRepositoryFixture {
  const controlDir = path.join(rootDir, 'control');
  const experimentDir = path.join(rootDir, 'experiment');
  const resultsDirectory = path.join(rootDir, 'compare-bisect-results');
  git(rootDir, ['clone', '--quiet', sourceDir, controlDir]);
  git(rootDir, ['clone', '--quiet', sourceDir, experimentDir]);
  git(controlDir, ['checkout', '--quiet', '--detach', shas[goodLabel]!]);
  if (git(experimentDir, ['rev-parse', 'HEAD']) !== shas[badLabel]) {
    throw new Error(`Experiment clone did not resolve bad fixture label ${badLabel}`);
  }

  const experimentBranch = git(experimentDir, ['branch', '--show-current']);
  const originalExperimentSha = git(experimentDir, ['rev-parse', 'HEAD']);
  const config = {
    bisect: {
      rebuildContainer: false,
    },
    twinServers: {
      rebuildCommands: [{ description: 'Build application', command: 'yarn build' }],
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
  const candidateComparisonCalls: CompareRunRequest[] = [];
  const experimentReloadCalls: ExperimentReloadRequest[] = [];
  const nativeGit = new NativeGitBisectDriver({ repoDir: fixture.experimentDir });
  const exactCheckout = new ExactCheckout({ repoDir: fixture.experimentDir });
  let tick = 0;

  return {
    candidateComparisonCalls,
    experimentReloadCalls,
    dependencies: {
      nativeGit,
      exactCheckout,
      installSignalHandlers() {
        return () => undefined;
      },
      async beginSession() {},
      async endSession() {},
      startNativeBisect: (group) => startNativeBisect({
        repoDir: fixture.experimentDir,
        goodSha: group.goodSha,
        badSha: group.badSha,
      }),
      markNativeBisect: (verdict) => markNativeBisect(fixture.experimentDir, verdict),
      resetNativeBisect: () => resetNativeBisect(fixture.experimentDir),
      previewNativeBisect: async (group) => {
        try {
          return await startNativeBisect({
            repoDir: fixture.experimentDir,
            goodSha: group.goodSha,
            badSha: group.badSha,
            noCheckout: true,
          });
        } finally {
          await resetNativeBisect(fixture.experimentDir);
        }
      },
      async reloadExperiment(request) {
        experimentReloadCalls.push({ ...request });
        if (request.sha === options.containerFallbackAtSha) {
          return { mode: 'container', usedFallback: true };
        }
        return { mode: request.preferredExperimentReloadMode, usedFallback: false };
      },
      async runCandidateComparisons(request) {
        candidateComparisonCalls.push({
          ...request,
          categories: [...request.categories],
          tests: [...request.tests],
        });
        if (request.sha === options.failAtSha) {
          throw new Error(`Stubbed compare failure at ${request.sha}`);
        }
        const results = options.resultsBySha[request.sha];
        if (!results) {
          throw new Error(`No stubbed compare results for ${request.sha}`);
        }
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
        if (!results) {
          throw new Error(`No reusable compare results for ${request.sha}`);
        }
        return { testResults: results };
      },
    },
  };
}

export function visregTimeline(
  fixture: E2eRepositoryFixture,
  states: Record<string, boolean>,
): Record<string, readonly TestResult[]> {
  return Object.fromEntries(Object.entries(states).map(([label, regressionDetected]) => {
    const sha = fixture.shas[label];
    if (!sha) {
      throw new Error(`Unknown fixture label: ${label}`);
    }
    return [sha, [visregResult(regressionDetected)]];
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
    if (!sha) {
      throw new Error(`Unknown fixture label: ${label}`);
    }
    for (const id of presentIds) {
      if (!targetIds.has(id)) {
        throw new Error(`Unknown regression target: ${id}`);
      }
    }
    const targetsWithRegression = new Set(presentIds);
    const grouped = new Map<string, StubRegression[]>();
    for (const target of targets) {
      const key = JSON.stringify([target.testFile, target.testName]);
      grouped.set(key, [...(grouped.get(key) ?? []), target]);
    }
    return [sha, [...grouped.values()].map((group) => regressionResult(group, targetsWithRegression))];
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
  targetsWithRegression: ReadonlySet<string>,
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
          diffImage: targetsWithRegression.has(target.id) ? `${target.id}-diff.png` : null,
          misMatchPercentage: targetsWithRegression.has(target.id) ? 2.5 : 0,
          diffPixels: targetsWithRegression.has(target.id) ? 42 : 0,
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
            experimentValue: targetsWithRegression.has(target.id) ? 120 : 100,
            deltaValue: targetsWithRegression.has(target.id) ? 20 : 0,
            controlDisplay: '100ms',
            experimentDisplay: targetsWithRegression.has(target.id) ? '120ms' : '100ms',
            deltaDisplay: targetsWithRegression.has(target.id) ? '+20ms' : '0ms',
            percentDisplay: targetsWithRegression.has(target.id) ? '+20%' : '0%',
            deltaPercent: targetsWithRegression.has(target.id) ? 20 : 0,
            pValue: targetsWithRegression.has(target.id) ? 0.01 : 1,
            direction: targetsWithRegression.has(target.id) ? 'regression' as const : 'none' as const,
          })),
        },
      }]),
      ...(accessibilityTargets.length === 0 ? [] : [{
        kind: 'ok' as const,
        stage: 'accessibility',
        viewport: DESKTOP_VIEWPORT,
        measurement: accessibilityMeasurement(accessibilityTargets, targetsWithRegression),
      }]),
    ],
  };
}

function accessibilityMeasurement(
  targets: readonly StubRegression[],
  targetsWithRegression: ReadonlySet<string>,
) {
  const findings = targets.filter((target) => targetsWithRegression.has(target.id)).map((target) => ({
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

function visregResult(regressionDetected: boolean): TestResult {
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
        diffImage: regressionDetected ? 'diff.png' : null,
        misMatchPercentage: regressionDetected ? 2.5 : 0,
        diffPixels: regressionDetected ? 42 : 0,
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
  const bisectStartPath = git(fixture.experimentDir, ['rev-parse', '--git-path', 'BISECT_START']);
  expect(fs.existsSync(path.resolve(fixture.experimentDir, bisectStartPath))).toBe(false);
}

export function expectBinarySearchTraversal(
  harness: E2eDependencyHarness,
  fixture: E2eRepositoryFixture,
  expectedCommitLabels: readonly string[],
): void {
  const labelsBySha = new Map(Object.entries(fixture.shas).map(([label, sha]) => [sha, label]));
  const actualCommitLabels = harness.candidateComparisonCalls.map((call) => {
    const label = labelsBySha.get(call.sha);
    if (!label) {
      throw new Error(`Compare traversed unknown commit ${call.sha}`);
    }
    return label;
  });
  expect(actualCommitLabels).toEqual(expectedCommitLabels);
}

export function expectFirstBadCommits(
  session: BisectSession,
  fixture: E2eRepositoryFixture,
  expected: readonly ExpectedFirstBadCommit[],
): void {
  for (const { regression, commit } of expected) {
    expect(targetForRegression(session, regression)).toMatchObject({
      status: 'found',
      firstBadSha: fixture.shas[commit],
    });
  }
}

export function expectMergeAttributions(
  session: BisectSession,
  fixture: E2eRepositoryFixture,
  mergeCommit: string,
  expected: readonly ExpectedMergeAttribution[],
): void {
  const investigation = session.mergeInvestigations[fixture.shas[mergeCommit]!];
  expect(investigation?.status).toBe('complete');
  for (const { regression, sourceCommit } of expected) {
    const target = targetForRegression(session, regression);
    expect(investigation?.targetResults[target.id]).toEqual(sourceCommit === null
      ? { kind: 'merge-introduced' }
      : { kind: 'source-found', sourceSha: fixture.shas[sourceCommit] });
  }
}

function targetForRegression(session: BisectSession, regression: StubRegression) {
  const matchingTargets = session.primary.targets.filter((target) => (
    target.category === regression.category
    && target.testFile === regression.testFile
    && target.testName === regression.testName
    && target.subject === regression.subject
  ));
  expect(matchingTargets).toHaveLength(1);
  return matchingTargets[0]!;
}

export function readPersistedSession(fixture: E2eRepositoryFixture): BisectSession {
  return parseBisectSession(JSON.parse(fs.readFileSync(
    path.join(fixture.resultsDirectory, 'session.json'),
    'utf8',
  )));
}
