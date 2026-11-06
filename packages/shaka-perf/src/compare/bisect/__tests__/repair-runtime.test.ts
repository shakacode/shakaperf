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
import {
  BisectRepairTransactionError,
  ConfiguredBisectRepairRuntime,
  type BisectRepairCommandRunner,
} from '../repair-runtime';
import type { BisectRepair } from '../types';

describe('configured bisect repair runtime', () => {
  let rootDir: string;
  let repoDir: string;
  let resultsDirectory: string;
  let candidateSha: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-repair-runtime-'));
    repoDir = path.join(rootDir, 'experiment');
    resultsDirectory = path.join(rootDir, 'compare-bisect-results');
    fs.mkdirSync(repoDir);
    fs.mkdirSync(path.join(resultsDirectory, 'patches'), { recursive: true });
    git(['init', '--initial-branch=main']);
    git(['config', 'user.email', 'runtime@example.com']);
    git(['config', 'user.name', 'Repair Runtime']);
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'value=0\n');
    git(['add', 'app.txt']);
    git(['commit', '-m', 'candidate']);
    candidateSha = git(['rev-parse', 'HEAD']);
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('applies overlapping patches and cleans commands and files in reverse order', async () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'value=1\n');
    writePatch('first.patch');
    git(['add', 'app.txt']);
    git(['commit', '-m', 'patch one base']);
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'value=2\n');
    writePatch('second.patch');
    git(['checkout', '--', 'app.txt']);
    git(['checkout', '--detach', candidateSha]);

    const commandEvents: string[] = [];
    const runtime = runtimeWith([
      repair('first', 'first.patch', {
        order: 0,
        prepareCommands: [{ description: 'Prepare first', command: 'prepare-first' }],
        cleanupCommands: [{ description: 'Clean first', command: 'cleanup-first' }],
      }),
      repair('second', 'second.patch', {
        order: 1,
        prepareCommands: [{ description: 'Prepare second', command: 'prepare-second' }],
        cleanupCommands: [{ description: 'Clean second', command: 'cleanup-second' }],
      }),
    ], {
      async runRepairCommands(phase, commands) {
        commandEvents.push(`${phase}:${commands.join(',')}`);
      },
    });

    const result = await runtime.withRepairs({
      sha: candidateSha,
      evaluationId: 'primary-attempt-1',
      run: async ({ prepare }) => {
        expect(fs.readFileSync(path.join(repoDir, 'app.txt'), 'utf8')).toBe('value=2\n');
        await prepare();
        return 'measured';
      },
    });

    expect(result.value).toBe('measured');
    expect(result.evidence.repairIds).toEqual(['first', 'second']);
    expect(result.evidence.applications).toEqual([
      expect.objectContaining({
        repairId: 'first', apply: 'succeeded', prepare: 'succeeded',
        cleanup: 'succeeded', reverse: 'succeeded',
      }),
      expect.objectContaining({
        repairId: 'second', apply: 'succeeded', prepare: 'succeeded',
        cleanup: 'succeeded', reverse: 'succeeded',
      }),
    ]);
    expect(commandEvents).toEqual([
      'prepare:prepare-first',
      'prepare:prepare-second',
      'cleanup:cleanup-second',
      'cleanup:cleanup-first',
    ]);
    expect(fs.readFileSync(path.join(repoDir, 'app.txt'), 'utf8')).toBe('value=0\n');
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('removes files introduced by a patch', async () => {
    fs.writeFileSync(path.join(repoDir, 'new-test.abtest.ts'), 'export default true;\n');
    git(['add', '-N', 'new-test.abtest.ts']);
    writePatch('new-test.patch');
    git(['reset']);
    fs.rmSync(path.join(repoDir, 'new-test.abtest.ts'));

    const runtime = runtimeWith([repair('new-test', 'new-test.patch')]);
    await runtime.withRepairs({
      sha: candidateSha,
      evaluationId: 'candidate',
      run: async ({ prepare }) => {
        expect(fs.existsSync(path.join(repoDir, 'new-test.abtest.ts'))).toBe(true);
        await prepare();
        return true;
      },
    });

    expect(fs.existsSync(path.join(repoDir, 'new-test.abtest.ts'))).toBe(false);
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('applies all-commit repairs without an enumerated SHA list', async () => {
    fs.writeFileSync(path.join(repoDir, 'all.txt'), 'all commits\n');
    git(['add', '-N', 'all.txt']);
    writePatch('all.patch');
    git(['reset']);
    fs.rmSync(path.join(repoDir, 'all.txt'));

    const runtime = runtimeWith([repair('all', 'all.patch', {
      appliesToAll: true,
      applicableShas: [],
    })]);
    const result = await runtime.withRepairs({
      sha: candidateSha,
      evaluationId: 'all-candidate',
      run: async ({ prepare }) => {
        expect(fs.readFileSync(path.join(repoDir, 'all.txt'), 'utf8')).toBe('all commits\n');
        await prepare();
        return true;
      },
    });

    expect(result.evidence.repairIds).toEqual(['all']);
    expect(fs.existsSync(path.join(repoDir, 'all.txt'))).toBe(false);
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('treats a patch already present in the candidate as satisfied', async () => {
    fs.writeFileSync(path.join(repoDir, 'native-test.abtest.ts'), 'export default true;\n');
    git(['add', '-N', 'native-test.abtest.ts']);
    writePatch('native-test.patch');
    git(['add', 'native-test.abtest.ts']);
    git(['commit', '-m', 'candidate already contains repair']);
    candidateSha = git(['rev-parse', 'HEAD']);

    const commandRunner: BisectRepairCommandRunner = {
      runRepairCommands: jest.fn(async () => undefined),
    };
    const runtime = runtimeWith([repair('native-test', 'native-test.patch', {
      appliesToAll: true,
      applicableShas: [],
      prepareCommands: [{ description: 'Prepare', command: 'prepare' }],
      cleanupCommands: [{ description: 'Cleanup', command: 'cleanup' }],
    })], commandRunner);

    const result = await runtime.withRepairs({
      sha: candidateSha,
      evaluationId: 'native-candidate',
      run: async ({ prepare }) => {
        expect(fs.readFileSync(path.join(repoDir, 'native-test.abtest.ts'), 'utf8'))
          .toBe('export default true;\n');
        await prepare();
        return true;
      },
    });

    expect(result.evidence.applications).toEqual([
      expect.objectContaining({
        repairId: 'native-test', apply: 'succeeded', prepare: 'succeeded',
        cleanup: 'succeeded', reverse: 'succeeded',
      }),
    ]);
    expect(commandRunner.runRepairCommands).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(path.join(repoDir, 'native-test.abtest.ts'), 'utf8'))
      .toBe('export default true;\n');
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('rolls back earlier patches when a later patch cannot apply', async () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'value=1\n');
    writePatch('valid.patch');
    git(['checkout', '--', 'app.txt']);
    fs.writeFileSync(path.join(resultsDirectory, 'patches', 'invalid.patch'), [
      'diff --git a/missing.txt b/missing.txt',
      '--- a/missing.txt',
      '+++ b/missing.txt',
      '@@ -1 +1 @@',
      '-missing',
      '+changed',
      '',
    ].join('\n'));

    const runtime = runtimeWith([
      repair('valid', 'valid.patch', { order: 0 }),
      repair('invalid', 'invalid.patch', { order: 1 }),
    ]);
    const run = jest.fn(async () => true);

    await expect(runtime.withRepairs({
      sha: candidateSha,
      evaluationId: 'candidate',
      run,
    })).rejects.toMatchObject({
      name: 'BisectRepairTransactionError',
      evidence: {
        applications: [
          expect.objectContaining({ repairId: 'valid', reverse: 'succeeded' }),
          expect.objectContaining({ repairId: 'invalid', apply: 'failed' }),
        ],
      },
    });
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(repoDir, 'app.txt'), 'utf8')).toBe('value=0\n');
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('preserves evaluation and cleanup failures while still reversing the patch', async () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'value=1\n');
    writePatch('compat.patch');
    git(['checkout', '--', 'app.txt']);
    const runtime = runtimeWith([repair('compat', 'compat.patch', {
      cleanupCommands: [{ description: 'Cleanup', command: 'fail-cleanup' }],
    })], {
      async runRepairCommands(phase) {
        if (phase === 'cleanup') throw new Error('cleanup exploded');
      },
    });

    let thrown: unknown;
    try {
      await runtime.withRepairs({
        sha: candidateSha,
        evaluationId: 'candidate',
        run: async ({ prepare }) => {
          await prepare();
          throw new Error('comparison exploded');
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BisectRepairTransactionError);
    const transactionError = thrown as BisectRepairTransactionError;
    expect(transactionError.originalError).toBeInstanceOf(AggregateError);
    expect(transactionError.evidence.applications[0]).toMatchObject({
      cleanup: 'failed',
      reverse: 'succeeded',
    });
    expect(fs.readFileSync(path.join(repoDir, 'app.txt'), 'utf8')).toBe('value=0\n');
    expect(git(['status', '--porcelain'])).toBe('');
  });

  function runtimeWith(
    repairs: BisectRepair[],
    commandRunner: BisectRepairCommandRunner = { async runRepairCommands() {} },
  ): ConfiguredBisectRepairRuntime {
    return new ConfiguredBisectRepairRuntime({
      repoDir,
      resultsDirectory,
      repairs,
      commandRunner,
    });
  }

  function repair(
    id: string,
    filename: string,
    overrides: Partial<BisectRepair> = {},
  ): BisectRepair {
    return {
      id,
      kind: 'build',
      purpose: `${id} purpose`,
      filename: `patches/${filename}`,
      sha256: `${id}-hash`,
      order: 0,
      appliesToAll: false,
      applicableShas: [candidateSha],
      prepareCommands: [],
      cleanupCommands: [],
      registeredAt: 'registered',
      source: 'manifest',
      ...overrides,
    };
  }

  function writePatch(filename: string): void {
    const contents = execFileSync(
      'git',
      ['diff', '--binary', '--full-index'],
      { cwd: repoDir, encoding: 'utf8' },
    );
    fs.writeFileSync(path.join(resultsDirectory, 'patches', filename), contents);
  }

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
  }
});
