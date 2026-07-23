/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command } from 'commander';
import { createCompareCommand } from '../../cli/program';
import { createBisectCommand } from '../cli';
import { runCompareBisectFromCli } from '../session';
import { parseAbTestsConfig, type AbTestsConfig } from '../../../config';
import type { BisectSession } from '../types';

describe('compare bisect command', () => {
  it('registers optional refs without replacing the compare action', async () => {
    const compare = await createCompareCommand();

    expect(compare.commands.map((command) => command.name())).toContain('bisect');
    expect(compare.registeredArguments).toHaveLength(0);
    expect((compare as unknown as { _actionHandler?: unknown })._actionHandler).toEqual(expect.any(Function));

    const bisect = compare.commands.find((command) => command.name() === 'bisect')!;
    expect(bisect.registeredArguments.map((argument) => argument.name())).toEqual([
      'good-ref',
      'bad-ref',
    ]);
  });

  it('passes inherited compare options including endpoint overrides', async () => {
    const run = jest.fn(async () => undefined);
    const program = new Command()
      .exitOverride()
      .name('shaka-perf');
    const compare = new Command('compare')
      .option('--config <path>')
      .option('--categories <list>')
      .option('--filter <value>')
      .option('--testPathPattern <regex>')
      .option('--headed')
      .option('--controlURL <url>')
      .option('--experimentURL <url>');
    compare.addCommand(createBisectCommand({ run }));
    program.addCommand(compare);

    await program.parseAsync([
      'compare',
      '--config', '/tmp/abtests.config.ts',
      '--categories', 'visreg,perf',
      '--filter', 'checkout',
      '--testPathPattern', 'checkout\\.abtest',
      '--headed',
      '--controlURL', 'http://control.override',
      '--experimentURL', 'http://experiment.override',
      'bisect',
      'good-ref',
      'bad-ref',
    ], { from: 'user' });

    expect(run).toHaveBeenCalledWith('good-ref', 'bad-ref', {
      configPath: '/tmp/abtests.config.ts',
      categories: 'visreg,perf',
      filter: 'checkout',
      testPathPattern: 'checkout\\.abtest',
      headed: true,
      controlURL: 'http://control.override',
      experimentURL: 'http://experiment.override',
      reuseCurrentResults: false,
      dryRun: false,
      validateGoodRef: false,
      reportOnly: false,
      resume: false,
      investigateMerges: false,
    });
  });

  it('passes report-only from the bisect subcommand', async () => {
    const run = jest.fn(async () => undefined);
    const program = new Command().exitOverride().name('shaka-perf');
    const compare = new Command('compare');
    compare.addCommand(createBisectCommand({ run }));
    program.addCommand(compare);

    await program.parseAsync(['compare', 'bisect', '--report-only'], { from: 'user' });

    expect(run).toHaveBeenCalledWith(undefined, undefined, expect.objectContaining({
      reportOnly: true,
    }));
  });

  it('keeps report-only enabled when the compare parent defines the same option', async () => {
    const run = jest.fn(async () => undefined);
    const program = new Command().exitOverride().name('shaka-perf');
    const compare = new Command('compare').option('--report-only', 'parent report mode', false);
    compare.addCommand(createBisectCommand({ run }));
    program.addCommand(compare);

    await program.parseAsync(['compare', 'bisect', '--report-only'], { from: 'user' });

    expect(run).toHaveBeenCalledWith(undefined, undefined, expect.objectContaining({
      reportOnly: true,
    }));
  });

  it('passes resume and merge-investigation flags and rejects unsafe resume combinations', async () => {
    const run = jest.fn(async () => undefined);
    const command = createBisectCommand({ run }).exitOverride();

    await command.parseAsync(['--resume', '--investigate-merges'], { from: 'user' });
    expect(run).toHaveBeenCalledWith(undefined, undefined, expect.objectContaining({
      resume: true,
      investigateMerges: true,
    }));

    await expect(createBisectCommand({ run: jest.fn() }).exitOverride()
      .parseAsync(['good', '--resume'], { from: 'user' }))
      .rejects.toThrow(/resume.*positional/i);
    await expect(createBisectCommand({ run: jest.fn() }).exitOverride()
      .parseAsync(['--resume', '--dry-run'], { from: 'user' }))
      .rejects.toThrow(/resume.*dry-run/i);
    await expect(createBisectCommand({ run: jest.fn() }).exitOverride()
      .parseAsync(['--report-only', '--resume'], { from: 'user' }))
      .rejects.toThrow(/report-only.*resume/i);
  });

  it('accepts bisect categories and current-result reuse after the subcommand', async () => {
    const run = jest.fn(async () => undefined);
    const program = new Command()
      .exitOverride()
      .name('shaka-perf');
    const compare = new Command('compare')
      .option('--categories <list>', 'parent category option', 'visreg,perf,accessibility');
    compare.addCommand(createBisectCommand({ run }));
    program.addCommand(compare);

    await program.parseAsync([
      'compare',
      'bisect',
      'good-ref',
      'bad-ref',
      '--categories', 'accessibility',
      '--reuse-current-results',
      '--dry-run',
      '--validate-good-ref',
    ], { from: 'user' });

    expect(run).toHaveBeenCalledWith('good-ref', 'bad-ref', expect.objectContaining({
      categories: 'accessibility',
      reuseCurrentResults: true,
      dryRun: true,
      validateGoodRef: true,
    }));
  });

  it('loads config and frozen tests once before calling runBisect', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const parsedConfig = {
      shared: {
        controlURL: 'http://control.config',
        experimentURL: 'http://experiment.config',
      },
      twinServers: { experimentDir: 'experiment' },
    } as AbTestsConfig;
    const resolvedTwinServers = { projectSlug: 'fixture' };
    const loadConfig = jest.fn(async () => ({ raw: true }));
    const loadFrozenTests = jest.fn(async () => []);
    const run = jest.fn(async () => completedSession());

    try {
      await runCompareBisectFromCli('good', 'bad', {
        configPath: '/tmp/abtests.config.ts',
        categories: 'visreg',
        controlURL: 'http://control.override',
        experimentURL: 'http://experiment.override',
        reuseCurrentResults: true,
        dryRun: true,
        validateGoodRef: true,
      }, {
        loadConfig,
        parseConfig: () => parsedConfig,
        resolveTwinServers: () => resolvedTwinServers as never,
        loadFrozenTests,
        run,
      });
    } finally {
      consoleLog.mockRestore();
    }

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(loadFrozenTests).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      goodRef: 'good',
      badRef: 'bad',
      config: parsedConfig,
      twinServers: resolvedTwinServers,
      frozenTests: [],
      controlURL: 'http://control.override',
      experimentURL: 'http://experiment.override',
      reuseCurrentResults: true,
      dryRun: true,
      validateGoodRef: true,
    }));
  });

  it('regenerates a report without resolving servers, loading tests, or running bisect', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const session = completedSession();
    const resolveTwinServers = jest.fn(() => { throw new Error('must not resolve servers'); });
    const loadFrozenTests = jest.fn(async () => { throw new Error('must not load tests'); });
    const run = jest.fn(async () => { throw new Error('must not run bisect'); });
    const regenerateReport = jest.fn(() => ({
      session,
      htmlPath: '/tmp/compare-bisect-results/bisect-report.html',
      dataPath: '/tmp/compare-bisect-results/bisect-report.json',
    }));

    try {
      const result = await runCompareBisectFromCli(undefined, undefined, {
        configPath: '/tmp/abtests.config.ts',
        reportOnly: true,
      }, {
        loadConfig: async () => ({}),
        parseConfig: () => reportOnlyConfig(),
        resolveTwinServers,
        loadFrozenTests,
        run,
        regenerateReport,
      });

      expect(result).toBe(session);
      expect(regenerateReport).toHaveBeenCalledTimes(1);
      expect(resolveTwinServers).not.toHaveBeenCalled();
      expect(loadFrozenTests).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
    }
  });

  it('rejects positional refs in report-only mode', async () => {
    await expect(runCompareBisectFromCli('good', undefined, {
      configPath: '/tmp/abtests.config.ts',
      reportOnly: true,
    }, {
      loadConfig: async () => ({}),
      parseConfig: () => reportOnlyConfig(),
    })).rejects.toThrow('compare bisect --report-only does not accept good-ref or bad-ref');
  });

  it('prints discovered targets and the next action for a dry run', async () => {
    const output: string[] = [];
    const consoleLog = jest.spyOn(console, 'log').mockImplementation((message = '') => {
      output.push(String(message));
    });
    const parsedConfig = {
      shared: {
        controlURL: 'http://control.config',
        experimentURL: 'http://experiment.config',
      },
      twinServers: { experimentDir: 'experiment' },
    } as AbTestsConfig;
    const targetId = '["visreg","tests/homepage.abtest.ts","Homepage","desktop","document"]';
    const run = jest.fn(async (): Promise<BisectSession> => {
      const session = completedSession();
      return {
        ...session,
        originalExperiment: { sha: 'bad-sha', branch: 'feature' },
        primary: {
          ...session.primary,
          goodSha: 'good-sha',
          badSha: 'bad-sha',
          orderedCommits: ['good-sha', 'middle-sha', 'bad-sha'],
          commitSubjects: {
            'good-sha': 'good', 'middle-sha': 'middle', 'bad-sha': 'bad',
          },
          commitParents: {
            'good-sha': [], 'middle-sha': ['good-sha'], 'bad-sha': ['middle-sha'],
          },
          targets: [{
        id: targetId,
        category: 'visreg',
        testFile: 'tests/homepage.abtest.ts',
        testName: 'Homepage',
        viewport: 'desktop',
        subject: 'document',
        status: 'active',
        goodIndex: 0,
        badIndex: 2,
        recordedTargetEvaluations: {},
          }],
        },
      };
    });

    try {
      await runCompareBisectFromCli('good-sha', 'bad-sha', {
        configPath: '/tmp/abtests.config.ts',
        categories: 'visreg',
        dryRun: true,
      }, {
        loadConfig: async () => ({ raw: true }),
        parseConfig: () => parsedConfig,
        resolveTwinServers: () => ({ projectSlug: 'fixture' }) as never,
        loadFrozenTests: async () => [],
        run,
      });
    } finally {
      consoleLog.mockRestore();
    }

    expect(output).toEqual(expect.arrayContaining([
      'Compare bisect dry run complete.',
      'Range: good-sha..bad-sha',
      'Targets discovered: 1',
      '  visreg Homepage desktop document',
      'Next: measure midpoint middle- for 1 target(s)',
      'Categories: visreg',
      'Tests: tests/homepage.abtest.ts :: Homepage',
    ]));
  });

  it('prints selected categories in the merge investigation follow-up', async () => {
    const output: string[] = [];
    const consoleLog = jest.spyOn(console, 'log').mockImplementation((message = '') => {
      output.push(String(message));
    });
    const target = {
      id: 'target', category: 'accessibility' as const, testFile: 'home.abtest.ts', testName: 'Home',
      viewport: 'desktop', subject: 'document', status: 'found' as const,
      goodIndex: 0, badIndex: 1, firstBadSha: 'merge-sha', recordedTargetEvaluations: {},
    };
    try {
      await runCompareBisectFromCli('good', 'merge-sha', {
        configPath: '/tmp/abtests.config.ts', categories: 'accessibility',
      }, {
        loadConfig: async () => ({}),
        parseConfig: () => ({
          shared: { controlURL: 'control', experimentURL: 'experiment' },
          twinServers: {},
        }) as AbTestsConfig,
        resolveTwinServers: () => ({}) as never,
        loadFrozenTests: async () => [],
        run: async () => ({
          ...completedSession(),
          compatibility: {
            ...completedSession().compatibility,
            effective: {
              ...completedSession().compatibility.effective,
              categories: ['accessibility'],
            },
          },
          originalExperiment: { sha: 'merge-sha', branch: 'main' },
          primary: {
            ...completedSession().primary,
            badSha: 'merge-sha',
            orderedCommits: ['good', 'merge-sha'],
            commitSubjects: { good: 'good', 'merge-sha': 'merge' },
            commitParents: { good: [], 'merge-sha': ['good', 'topic'] },
            targets: [target],
          },
          mergeQueue: ['merge-sha'],
          mergeInvestigations: {
            'merge-sha': {
              mergeSha: 'merge-sha', parents: ['main', 'topic'],
              status: 'merge-uninvestigated', targetIds: ['target'],
              targetResults: { target: { kind: 'merge-uninvestigated' } },
            },
          },
        }),
      });
    } finally {
      consoleLog.mockRestore();
    }

    expect(output).toContain(
      'shaka-perf compare bisect --categories accessibility --resume --investigate-merges',
    );
  });
});

function completedSession(): BisectSession {
  return {
    status: 'complete',
    mode: 'complete',
    identity: {
      controlRoot: '/repo/control', experimentRoot: '/repo/experiment',
      controlGitCommonDir: '/repo/control/.git', experimentGitCommonDir: '/repo/experiment/.git',
      controlOrigin: null, experimentOrigin: null,
    },
    compatibility: {
      configFingerprint: 'config', categoriesFingerprint: 'categories',
      testsFingerprint: 'tests', rebuildFingerprint: 'rebuild', rangeFingerprint: 'range',
      effective: {
        config: {}, categories: ['visreg'], tests: [],
        rebuildStrategy: { mode: 'commands', commands: [] },
        range: { goodSha: 'good', badSha: 'bad' },
      },
    },
    originalExperiment: { sha: 'bad', branch: 'feature' },
    control: { sha: 'good', branch: null },
    rebuildStrategy: { mode: 'commands', commands: [] },
    reportInput: { filename: 'bad-ref-tests.json', sha256: 'fixture' },
    primary: {
      id: 'primary', status: 'complete', goodSha: 'good', badSha: 'bad',
      orderedCommits: ['good', 'bad'], commitSubjects: { good: 'good', bad: 'bad' },
      commitParents: { good: [], bad: ['good'] }, targets: [], attempts: [],
    },
    mergeQueue: [],
    mergeInvestigations: {},
    commitRuns: {},
    startedAt: '2026-07-13T00:00:00.000Z',
    finishedAt: '2026-07-13T00:01:00.000Z',
  };
}

function reportOnlyConfig(): AbTestsConfig {
  return parseAbTestsConfig({
    shared: {
      controlURL: 'http://control.test',
      experimentURL: 'http://experiment.test',
      parallelism: 2,
      playwrightOptions: { browser: 'chromium' },
    },
  });
}
