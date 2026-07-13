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
import type { AbTestsConfig } from '../../../config';
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
    });
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
    ], { from: 'user' });

    expect(run).toHaveBeenCalledWith('good-ref', 'bad-ref', expect.objectContaining({
      categories: 'accessibility',
      reuseCurrentResults: true,
      dryRun: true,
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
    const run = jest.fn(async () => ({
      version: 1,
      status: 'complete',
      goodSha: 'good',
      badSha: 'bad',
      originalExperiment: { sha: 'bad', branch: 'feature' },
      selectedCategories: ['visreg'],
      orderedCommits: ['good', 'bad'],
      targets: [],
      commitRuns: {},
      startedAt: '2026-07-12T00:00:00.000Z',
      finishedAt: '2026-07-12T00:01:00.000Z',
    }) as BisectSession);

    try {
      await runCompareBisectFromCli('good', 'bad', {
        configPath: '/tmp/abtests.config.ts',
        categories: 'visreg',
        controlURL: 'http://control.override',
        experimentURL: 'http://experiment.override',
        reuseCurrentResults: true,
        dryRun: true,
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
    }));
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
    const run = jest.fn(async () => ({
      version: 1,
      status: 'complete',
      goodSha: 'good-sha',
      badSha: 'bad-sha',
      originalExperiment: { sha: 'bad-sha', branch: 'feature' },
      selectedCategories: ['visreg'],
      orderedCommits: ['good-sha', 'middle-sha', 'bad-sha'],
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
        observations: {},
      }],
      commitRuns: {},
      dryRun: true,
      nextAction: {
        kind: 'validate-good-ref',
        sha: 'good-sha',
        categories: ['visreg'],
        testFiles: ['tests/homepage.abtest.ts'],
        targetIds: [targetId],
      },
      startedAt: '2026-07-12T00:00:00.000Z',
      finishedAt: '2026-07-12T00:01:00.000Z',
    }) as BisectSession);

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
      'Next: validate good ref good-sh for 1 target(s)',
      'Categories: visreg',
      'Test files: tests/homepage.abtest.ts',
    ]));
  });
});
