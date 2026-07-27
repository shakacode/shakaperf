/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command } from 'commander';
import { createCompareCommand } from '../../cli/program';
import { createBisectCommand } from '../cli';
import { runCompareBisectFromCli } from '../session';
import { buildAbTestsConfig, type AbTestsConfig } from '../../../config';
import type { BisectSession } from '../types';

describe('bisect command', () => {
  it('registers at the top level with optional refs and not under compare', async () => {
    const program = new Command().name('shaka-perf');
    const compare = await createCompareCommand();
    const bisect = createBisectCommand();
    program.addCommand(compare);
    program.addCommand(bisect);

    expect(program.commands.map((command) => command.name())).toContain('bisect');
    expect(compare.commands.map((command) => command.name())).not.toContain('bisect');
    expect(compare.registeredArguments).toHaveLength(0);
    expect((compare as unknown as { _actionHandler?: unknown })._actionHandler).toEqual(expect.any(Function));
    expect(bisect.registeredArguments.map((argument) => argument.name())).toEqual([
      'good-ref',
      'bad-ref',
    ]);
  });

  it('rejects the removed nested command form', async () => {
    const program = new Command().exitOverride().name('shaka-perf');
    const compare = await createCompareCommand();
    compare.exitOverride();
    program.addCommand(compare);
    program.addCommand(createBisectCommand({ run: jest.fn() }));

    await expect(program.parseAsync(['compare', 'bisect'], { from: 'user' }))
      .rejects.toThrow(/too many arguments|unknown command/i);
  });

  it('shows the top-level invocation and config-derived endpoint defaults in help', () => {
    const program = new Command().name('shaka-perf');
    const bisect = createBisectCommand({
      optionDefaults: {
        controlURL: 'http://control.config',
        experimentURL: 'http://experiment.config',
      },
    });
    program.addCommand(bisect);

    const help = bisect.helpInformation();
    expect(help).toContain('Usage: shaka-perf bisect [options] [good-ref] [bad-ref]');
    expect(help).toContain('--config <path>');
    expect(help).toContain('--filter <value>');
    expect(help).toContain('--testPathPattern <regex>');
    expect(help).toContain('--controlURL <url>');
    expect(help).toContain('--experimentURL <url>');
    expect(help).toMatch(/Control server URL \(default:\s+"http:\/\/control\.config"\)/);
    expect(help).toMatch(/Experiment server URL \(default:\s+"http:\/\/experiment\.config"\)/);
  });

  it('shares measurement option definitions with compare', async () => {
    const defaults = {
      controlURL: 'http://control.config',
      experimentURL: 'http://experiment.config',
    };
    const compare = await createCompareCommand(defaults);
    const bisect = createBisectCommand({ optionDefaults: defaults });
    const sharedFlags = [
      '--categories <list>',
      '-c, --config <path>',
      '--filter <value>',
      '--testPathPattern <regex>',
      '--headed',
      '--controlURL <url>',
      '--experimentURL <url>',
    ];

    for (const flags of sharedFlags) {
      const compareOption = compare.options.find((option) => option.flags === flags);
      const bisectOption = bisect.options.find((option) => option.flags === flags);
      expect(compareOption).toBeDefined();
      expect(bisectOption).toBeDefined();
      expect(bisectOption?.description).toBe(compareOption?.description);
      if (flags !== '--categories <list>') {
        expect(bisectOption?.defaultValue).toBe(compareOption?.defaultValue);
      }
    }

    expect(compare.opts().categories).toBe('visreg,perf,accessibility');
    expect(bisect.opts().categories).toBeUndefined();
  });

  it('passes standalone options including endpoint overrides', async () => {
    const run = jest.fn(async () => undefined);
    const program = new Command()
      .exitOverride()
      .name('shaka-perf');
    program.addCommand(createBisectCommand({ run }));

    await program.parseAsync([
      'bisect',
      '--config', '/tmp/abtests.config.ts',
      '--categories', 'visreg,perf',
      '--filter', 'checkout',
      '--testPathPattern', 'checkout\\.abtest',
      '--headed',
      '--controlURL', 'http://control.override',
      '--experimentURL', 'http://experiment.override',
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

  it('passes report-only from the top-level command', async () => {
    const run = jest.fn(async () => undefined);
    const program = new Command().exitOverride().name('shaka-perf');
    program.addCommand(createBisectCommand({ run }));

    await program.parseAsync(['bisect', '--report-only'], { from: 'user' });

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
    program.addCommand(createBisectCommand({ run }));

    await program.parseAsync([
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
    })).rejects.toThrow('bisect --report-only does not accept good-ref or bad-ref');
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
        recordedTargetEvaluations: {},
          }],
          groups: [{
            id: 'primary-group-1',
            status: 'pending',
            goodSha: 'good-sha',
            badSha: 'bad-sha',
            targetIds: [targetId],
            decisions: [],
            previewCandidateSha: 'middle-sha',
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
      'Bisect dry run complete.',
      'Range: good-sha..bad-sha',
      'Targets discovered: 1',
      '  visreg Homepage desktop document',
      'Next: measure native bisect candidate middle- for 1 target(s)',
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
      firstBadSha: 'merge-sha', recordedTargetEvaluations: {},
    };
    const phoneTarget = {
      ...target,
      id: 'phone-target',
      viewport: 'phone',
      subject: 'button-name',
    };
    const plainTarget = {
      ...target,
      id: 'plain-target',
      testFile: 'product.abtest.ts',
      testName: 'Product',
      subject: 'link-name',
      firstBadSha: 'plain-sha',
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
            orderedCommits: ['good', 'plain-sha', 'merge-sha'],
            commitSubjects: { good: 'good', 'plain-sha': 'break product', 'merge-sha': 'merge deals' },
            commitParents: { good: [], 'plain-sha': ['good'], 'merge-sha': ['plain-sha', 'topic'] },
            targets: [target, phoneTarget, plainTarget],
          },
          mergeQueue: ['merge-sha'],
          mergeInvestigations: {
            'merge-sha': {
              mergeSha: 'merge-sha', parents: ['main', 'topic'],
              status: 'merge-uninvestigated', targetIds: ['target', 'phone-target'],
              targetResults: {
                target: { kind: 'merge-uninvestigated' },
                'phone-target': { kind: 'merge-uninvestigated' },
              },
            },
          },
        }),
      });
    } finally {
      consoleLog.mockRestore();
    }

    expect(output).toContain(
      'shaka-perf bisect --categories accessibility --resume --investigate-merges',
    );
    expect(output).toEqual(expect.arrayContaining([
      'Regressions by commit:',
      '  plain-s break product',
      '    accessibility',
      '      Product',
      '        desktop: link-name',
      '  merge-s merge deals · merge · investigation not started',
      '      Home',
      '        desktop: document',
      '        phone: button-name',
    ]));
    expect(output.indexOf('  plain-s break product')).toBeLessThan(
      output.indexOf('  merge-s merge deals · merge · investigation not started'),
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
      testsFingerprint: 'tests', rebuildFingerprint: 'rebuild',
      repairsFingerprint: 'repairs', rangeFingerprint: 'range',
      effective: {
        config: {}, categories: ['visreg'], tests: [],
        rebuildStrategy: { mode: 'commands', commands: [] },
        repairs: [],
        range: { goodSha: 'good', badSha: 'bad' },
      },
    },
    originalExperiment: { sha: 'bad', branch: 'feature' },
    control: { sha: 'good', branch: null },
    rebuildStrategy: { mode: 'commands', commands: [] },
    repairs: [],
    repairApplications: [],
    reportInput: { filename: 'bad-ref-tests.json', sha256: 'fixture' },
    primary: {
      id: 'primary', status: 'complete', goodSha: 'good', badSha: 'bad',
      orderedCommits: ['good', 'bad'], commitSubjects: { good: 'good', bad: 'bad' },
      commitParents: { good: [], bad: ['good'] }, targets: [], groups: [], attempts: [],
    },
    mergeQueue: [],
    mergeInvestigations: {},
    commitRuns: {},
    startedAt: '2026-07-13T00:00:00.000Z',
    finishedAt: '2026-07-13T00:01:00.000Z',
  };
}

function reportOnlyConfig(): AbTestsConfig {
  return buildAbTestsConfig({
    shared: {
      controlURL: 'http://control.test',
      experimentURL: 'http://experiment.test',
      parallelism: 2,
      playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 }, browserConsole: { failOn: ['error', 'warn'], allowList: [] },
    },
  });
}
