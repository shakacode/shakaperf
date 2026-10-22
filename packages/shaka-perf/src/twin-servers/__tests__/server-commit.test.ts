/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { readCheckoutCommit, readContainerCommit, recordReloadedExperimentCommit, logServerCommits, stageSyncedServerCommit, prepareSyncedServerCommits } from '../helpers/server-commit';
import { exec, execWithStdin } from '../helpers/shell';
import type { ResolvedConfig } from '../types';
import { rebuildExperimentInContainer } from '../commands/rebuild-experiment';
import { BisectSessionController } from '../commands/bisect-session';
import { syncChanges } from '../commands/sync-changes';

jest.mock('node:child_process', () => ({ ...jest.requireActual('node:child_process'), execFile: jest.fn() }));
jest.mock('../helpers/shell', () => ({ ...jest.requireActual('../helpers/shell'), exec: jest.fn(), execWithStdin: jest.fn() }));

const container = 'c'.repeat(64);
let marker: string;
let label: string;
let repository: string;

function commit(message: string) {
  execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.test', 'commit', '--allow-empty', '--cleanup=verbatim', '-F', '-'], { cwd: repository, input: message, stdio: 'pipe' });
  return readCheckoutCommit(repository)!;
}

function config(): ResolvedConfig {
  return { projectDir: repository, experimentDir: repository, controlDir: repository, dockerBuildDir: repository,
    dockerfile: 'Dockerfile', dockerBuildArgs: {}, composeFile: 'compose.yml', procfile: 'Procfile',
    images: { control: 'demo:control', experiment: 'demo:experiment' }, volumes: { control: path.join(repository, 'control-volume'), experiment: path.join(repository, 'experiment-volume') },
    ports: { control: 3020, experiment: 3030 }, setupCommands: [], rebuildCommands: [], copyIgnore: { files: [], folders: [] }, projectSlug: 'demo-commits' };
}

beforeEach(() => {
  repository = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-server-git-')));
  execFileSync('git', ['init', repository], { stdio: 'pipe' });
  fs.mkdirSync(config().volumes.control); fs.mkdirSync(config().volumes.experiment);
  fs.appendFileSync(path.join(repository, '.git/info/exclude'), '\ncontrol-volume/\nexperiment-volume/\n');
  marker = 'MISSING'; label = '';
  jest.mocked(exec).mockResolvedValue({ code: 0, stdout: container, stderr: '' });
  jest.mocked(execWithStdin).mockImplementation(async (_file, _args, options) => { marker = options.stdin; return { code: 0, stdout: '', stderr: '' }; });
  jest.mocked(execFile).mockImplementation(((_file: string, args: string[], _options: unknown, callback: (error: Error | null, output?: { stdout: string }) => void) => {
    if (args.includes('git')) callback(new Error('No .git in this image'));
    else callback(null, { stdout: args[0] === 'inspect' ? label : marker });
  }) as never);
});

afterEach(() => { fs.rmSync(repository, { recursive: true, force: true }); jest.clearAllMocks(); });

it('preserves the exact Git message and keeps the built identity when the checkout moves', async () => {
  const original = commit('Subject\n\n  Body with indentation\n\n');
  expect(original.message).toBe('Subject\n\n  Body with indentation\n\n');
  label = Buffer.from(JSON.stringify(original)).toString('base64');
  expect(commit('Later operator checkout\n').sha).not.toBe(original.sha);
  await expect(readContainerCommit(container, label)).resolves.toEqual(original);
});

it('invalidates identity during a reload, then replaces the image identity with the synced candidate', async () => {
  const built = commit('Original deployment\n');
  label = Buffer.from(JSON.stringify(built)).toString('base64');
  const candidate = commit('Bisect candidate\n\nCandidate body\n');
  stageSyncedServerCommit(config(), 'experiment');
  await recordReloadedExperimentCommit(config(), true);
  await expect(readContainerCommit(container, label)).resolves.toBeNull();
  await recordReloadedExperimentCommit(config());
  await expect(readContainerCommit(container, label)).resolves.toEqual(candidate);
  const restored = commit('Restored experiment\n');
  stageSyncedServerCommit(config(), 'experiment');
  await recordReloadedExperimentCommit(config(), true);
  await recordReloadedExperimentCommit(config());
  await expect(readContainerCommit(container, label)).resolves.toEqual(restored);
  expect(execWithStdin).toHaveBeenCalledWith('docker', expect.arrayContaining(['exec', '-i', container]), expect.objectContaining({ stdin: JSON.stringify(restored) }));
});

it('logs both server identities including their full messages', async () => {
  const built = commit('Server commit\n\nFull body\n');
  label = Buffer.from(JSON.stringify(built)).toString('base64');
  const write = jest.fn();
  await logServerCommits(config(), write);
  expect(write.mock.calls.map(([line]) => line)).toEqual([
    `control server commit ${built.sha}\n${built.message}`, `experiment server commit ${built.sha}\n${built.message}`,
  ]);
});

it('does not fall back to an old image identity after an invalidated or corrupt reload marker', async () => {
  label = Buffer.from(JSON.stringify(commit('Old image\n'))).toString('base64');
  marker = 'null';
  await expect(readContainerCommit(container, label)).resolves.toBeNull();
  marker = 'invalid JSON';
  await expect(readContainerCommit(container, label)).rejects.toThrow();
});


it('starts the staged source commit even after an unapplied operator checkout change, and preserves it on another restart', async () => {
  const built = commit('Built source\n');
  label = Buffer.from(JSON.stringify(built)).toString('base64');
  const synced = commit('Source copied into the volume\n\nFull synced message\n');
  stageSyncedServerCommit(config(), 'experiment');
  expect(commit('Unapplied operator checkout\n').sha).not.toBe(synced.sha);
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container, label)).resolves.toEqual(synced);
  jest.mocked(execWithStdin).mockClear();
  await prepareSyncedServerCommits(config());
  expect(execWithStdin).not.toHaveBeenCalled();
  await expect(readContainerCommit(container, label)).resolves.toEqual(synced);
});

it('preserves the built identity when no source has been synced', async () => {
  const built = commit('Built source\n');
  label = Buffer.from(JSON.stringify(built)).toString('base64');
  commit('Operator moved without syncing\n');
  await prepareSyncedServerCommits(config());
  expect(execWithStdin).not.toHaveBeenCalled();
  await expect(readContainerCommit(container, label)).resolves.toEqual(built);
});

it('does not let an older pending snapshot overwrite a successful explicit rebuild', async () => {
  commit('Pending source\n'); stageSyncedServerCommit(config(), 'experiment');
  const rebuilt = commit('Source actually rebuilt\n');
  stageSyncedServerCommit(config(), 'experiment');
  await recordReloadedExperimentCommit(config(), true);
  await recordReloadedExperimentCommit(config());
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container)).resolves.toEqual(rebuilt);
  expect(execWithStdin).toHaveBeenCalledTimes(2);
});

it('retains a pending snapshot after a failed marker write and never falls back to the operator checkout', async () => {
  const synced = commit('Synced source\n'); stageSyncedServerCommit(config(), 'experiment');
  commit('Unapplied checkout\n');
  jest.mocked(execWithStdin).mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'write failed' });
  await expect(prepareSyncedServerCommits(config())).rejects.toThrow('Cannot record');
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container)).resolves.toEqual(synced);
});

it('clears stale image identity after an incomplete source copy', async () => {
  label = Buffer.from(JSON.stringify(commit('Built source\n'))).toString('base64');
  stageSyncedServerCommit(config(), 'experiment', true);
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container, label)).resolves.toBeNull();
});


it.each(['rebuild', 'bisect'] as const)('publishes the applied snapshot when the operator checkout moves during %s', async (mode) => {
  const applied = commit('Applied application source\n\nOriginal full body\n');
  stageSyncedServerCommit(config(), 'experiment');
  // A different checkout is never copied into the application volume.
  commit('Unapplied checkout before reload\n');
  const moveCheckout = async () => {
    await expect(readContainerCommit(container)).resolves.toBeNull();
    commit('Unapplied operator checkout\n');
  };
  const dependencies = {
    recordExperimentCommit: recordReloadedExperimentCommit,
    restartExperimentProcesses: async () => {},
    waitForExperimentReady: moveCheckout,
    logExperimentCommit: async () => {},
  };
  if (mode === 'rebuild') {
    await rebuildExperimentInContainer({ ...config(), rebuildCommands: [{ command: 'build', description: 'build' }] }, { ...dependencies, runCommand: moveCheckout });
  } else {
    const controller = new BisectSessionController(config(), {
      ...dependencies, runExperimentCommand: moveCheckout,
      buildExperiment: async () => {}, recreateExperimentContainer: async () => {}, ownerProcessAlive: () => true,
    });
    controller.beginSession('snapshot', process.pid);
    await controller.reloadExperiment('snapshot', { mode: 'commands', rebuildCommands: ['build'], noCache: false });
  }
  expect(readCheckoutCommit(repository)!.sha).not.toBe(applied.sha);
  await expect(readContainerCommit(container)).resolves.toEqual(applied);
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container)).resolves.toEqual(applied);
});

it('retains the active container identity when checkout moves during invalidation with no pending source', async () => {
  const applied = commit('Applied source at reload start\n');
  label = Buffer.from(JSON.stringify(applied)).toString('base64');
  commit('Unapplied checkout before invalidation\n');
  jest.mocked(execWithStdin).mockImplementationOnce(async (_file, _args, options) => {
    marker = options.stdin;
    commit('Unapplied checkout during invalidation\n');
    return { code: 0, stdout: '', stderr: '' };
  });
  await recordReloadedExperimentCommit(config(), true);
  commit('Unapplied later checkout\n');
  await recordReloadedExperimentCommit(config());
  await expect(readContainerCommit(container)).resolves.toEqual(applied);
});

it('allows a successful reload when the running application Git identity is unavailable', async () => {
  const runCommand = jest.fn(async () => {});
  await expect(rebuildExperimentInContainer({ ...config(), rebuildCommands: [{ command: 'build', description: 'build' }] }, {
    recordExperimentCommit: recordReloadedExperimentCommit,
    runCommand,
    restartExperimentProcesses: async () => {},
    waitForExperimentReady: async () => {},
    logExperimentCommit: async () => {},
  })).resolves.toBeUndefined();
  expect(runCommand).toHaveBeenCalledWith(expect.anything(), 'experiment', 'build');
  await expect(readContainerCommit(container)).resolves.toBeNull();
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container)).resolves.toBeNull();
});

it('keeps a failed rebuild unavailable across ordinary restarts and source copies until a rebuild succeeds', async () => {
  label = Buffer.from(JSON.stringify(commit('Built source\n'))).toString('base64');
  commit('Source copied before failed build\n');
  stageSyncedServerCommit(config(), 'experiment');
  const dependencies = {
    recordExperimentCommit: recordReloadedExperimentCommit,
    runCommand: jest.fn(async (): Promise<void> => { throw new Error('Compilation failed'); }),
    restartExperimentProcesses: async () => {},
    waitForExperimentReady: async () => {},
    logExperimentCommit: async () => {},
  };
  const rebuildConfig = { ...config(), rebuildCommands: [{ command: 'build', description: 'build' }] };
  await expect(rebuildExperimentInContainer(rebuildConfig, dependencies)).rejects.toThrow('Compilation failed');
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container, label)).resolves.toBeNull();
  const repaired = commit('Copied source repair\n');
  stageSyncedServerCommit(config(), 'experiment');
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container, label)).resolves.toBeNull();
  dependencies.runCommand.mockImplementation(async () => {});
  await rebuildExperimentInContainer(rebuildConfig, dependencies);
  await expect(readContainerCommit(container, label)).resolves.toEqual(repaired);
});

it.each(['control', 'experiment'] as const)('keeps partial manual %s sync identity unknown through subsequent copies and reloads', async (side) => {
  fs.writeFileSync(path.join(repository, 'application.txt'), 'A');
  fs.writeFileSync(path.join(repository, 'other.txt'), 'original');
  execFileSync('git', ['add', 'application.txt', 'other.txt'], { cwd: repository });
  label = Buffer.from(JSON.stringify(commit('Built source A\n'))).toString('base64');
  fs.writeFileSync(path.join(config().volumes[side], 'application.txt'), 'A');
  fs.writeFileSync(path.join(repository, 'application.txt'), 'B');
  execFileSync('git', ['add', 'application.txt'], { cwd: repository });
  commit('Unapplied committed source B\n');
  fs.writeFileSync(path.join(repository, 'other.txt'), 'dirty edit');
  await syncChanges(config(), side);
  expect(fs.readFileSync(path.join(config().volumes[side], 'application.txt'), 'utf8')).toBe('A');
  expect(fs.readFileSync(path.join(config().volumes[side], 'other.txt'), 'utf8')).toBe('dirty edit');
  if (side === 'control') {
    await prepareSyncedServerCommits(config());
  } else {
    await rebuildExperimentInContainer(config(), {
      recordExperimentCommit: recordReloadedExperimentCommit,
      runCommand: async () => {}, restartExperimentProcesses: async () => {},
      waitForExperimentReady: async () => {}, logExperimentCommit: async () => {},
    });
  }
  await expect(readContainerCommit(container, label)).resolves.toBeNull();
  stageSyncedServerCommit(config(), side);
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container, label)).resolves.toBeNull();
});

it('invalidates identity after a failed manual source copy', async () => {
  label = Buffer.from(JSON.stringify(commit('Built source\n'))).toString('base64');
  fs.writeFileSync(path.join(repository, 'application.txt'), 'Untracked candidate');
  const copy = jest.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw new Error('Copy failed'); });
  try { await syncChanges(config(), 'experiment'); } finally { copy.mockRestore(); }
  await prepareSyncedServerCommits(config());
  await expect(readContainerCommit(container, label)).resolves.toBeNull();
});
