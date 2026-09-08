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
import { createBisectCommand } from '../cli';
import { createBisectPatchCommand, type PatchPrompt } from '../patch-cli';

describe('bisect patch CLI', () => {
  let rootDir: string;
  let repoDir: string;
  let output: string[];

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-patch-cli-'));
    repoDir = path.join(rootDir, 'repo');
    fs.mkdirSync(repoDir);
    git(['init', '--initial-branch=main']);
    git(['config', 'user.email', 'patches@example.com']);
    git(['config', 'user.name', 'Patch Tests']);
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'before\n');
    git(['add', 'app.txt']);
    git(['commit', '-m', 'initial']);
    output = [];
  });

  afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  it('registers patch as a bisect subcommand instead of a good ref', () => {
    const bisect = createBisectCommand();
    expect(bisect.commands.map((command) => command.name())).toContain('patch');
  });

  it('creates noninteractively from an existing patch and lists JSON', async () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const patchFile = path.join(rootDir, 'source.patch');
    fs.writeFileSync(patchFile, execFileSync('git', ['diff', '--binary', '--full-index'], { cwd: repoDir }));
    git(['restore', 'app.txt']);

    await command(false).parseAsync([
      'create', 'compat', '--patch-file', patchFile, '--kind', 'build', '--all', '--no-interactive',
    ], { from: 'user' });
    await command(false).parseAsync(['list', '--json'], { from: 'user' });

    const listed = JSON.parse(output.at(-1)!) as Array<{ id: string; source: { kind: string } }>;
    expect(listed).toMatchObject([{ id: 'compat', source: { kind: 'patch-file' } }]);
  });

  it('walks a bare create interactively and update preserves patch bytes', async () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const createPrompt = new ScriptedPrompt({
      selects: ['working-tree', 'test-harness', 'all'],
      inputs: ['app.txt', 'Keep historical tests runnable'],
    });
    await command(true, createPrompt).parseAsync(['create', 'compat'], { from: 'user' });
    const artifact = path.join(rootDir, 'bisect-repairs', 'compat.patch');
    const before = fs.readFileSync(artifact);
    git(['restore', 'app.txt']);

    const updatePrompt = new DefaultsPrompt();
    await command(true, updatePrompt).parseAsync(['update', 'compat'], { from: 'user' });

    expect(fs.readFileSync(artifact).equals(before)).toBe(true);
    expect(updatePrompt.initialSelections).toEqual(['test-harness', 'all']);
    expect(updatePrompt.initialInputs).toContain('Keep historical tests runnable');
  });

  it('pins refs entered during metadata updates to commit SHAs', async () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    await command(false).parseAsync([
      'create', 'compat', '--working-tree', '--kind', 'build', '--all',
      '--no-interactive', '--', 'app.txt',
    ], { from: 'user' });
    git(['restore', 'app.txt']);
    const prompt = new ScriptedPrompt({
      selects: ['build', 'commits'],
      inputs: ['', 'HEAD'],
    });

    await command(true, prompt).parseAsync(['update', 'compat'], { from: 'user' });

    const manifest = JSON.parse(fs.readFileSync(
      path.join(rootDir, 'bisect-repairs', 'manifest.json'),
      'utf8',
    )) as { patches: Array<{ appliesTo: { commits: string[] } }> };
    expect(manifest.patches[0]?.appliesTo.commits).toEqual([git(['rev-parse', 'HEAD'])]);
  });

  it('edits from working-tree content and applies and reverses by ID', async () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'one\n');
    await command(false).parseAsync([
      'create', 'compat', '--working-tree', '--kind', 'build', '--all', '--no-interactive',
      '--', 'app.txt',
    ], { from: 'user' });
    git(['restore', 'app.txt']);
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'two\n');
    await command(false).parseAsync([
      'edit', 'compat', '--working-tree', '--no-interactive', '--', 'app.txt',
    ], { from: 'user' });
    git(['restore', 'app.txt']);

    await command(false).parseAsync(['apply', 'compat', '--check'], { from: 'user' });
    await command(false).parseAsync(['apply', 'compat'], { from: 'user' });
    expect(fs.readFileSync(path.join(repoDir, 'app.txt'), 'utf8')).toBe('two\n');
    await command(false).parseAsync(['apply', 'compat', '--reverse'], { from: 'user' });
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('requires exactly one source and --yes for noninteractive removal', async () => {
    await expect(command(false).parseAsync([
      'create', 'bad', '--working-tree', '--patch-file', 'x.patch',
      '--kind', 'build', '--all', '--no-interactive', '--all-files',
    ], { from: 'user' })).rejects.toThrow(/exactly one patch source/i);

    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    await command(false).parseAsync([
      'create', 'compat', '--working-tree', '--kind', 'build', '--all',
      '--no-interactive', '--', 'app.txt',
    ], { from: 'user' });
    await expect(command(false).parseAsync([
      'remove', 'compat', '--no-interactive',
    ], { from: 'user' })).rejects.toThrow(/requires --yes/i);
    await command(false).parseAsync(['remove', 'compat', '--yes'], { from: 'user' });
    expect(fs.existsSync(path.join(rootDir, 'bisect-repairs', 'compat.patch'))).toBe(false);
  });

  it('refuses mutations while bisect owns the project', async () => {
    const busy = createBisectPatchCommand({
      resolveContext: async () => ({ configDirectory: rootDir, repoDir }),
      isInteractive: () => false,
      assertMutable: async () => { throw new Error('active bisect lease'); },
      print: (message) => output.push(message),
    }).exitOverride();
    await expect(busy.parseAsync([
      'create', 'compat', '--working-tree', '--kind', 'build', '--all',
      '--all-files', '--no-interactive',
    ], { from: 'user' })).rejects.toThrow(/active bisect lease/i);
  });

  it('refuses mutations when a running server uses an incompatible protocol', async () => {
    fs.writeFileSync(path.join(repoDir, 'app.txt'), 'after\n');
    const incompatible = createBisectPatchCommand({
      resolveContext: async () => ({ configDirectory: rootDir, repoDir, projectSlug: 'project' }),
      isInteractive: () => false,
      tryProxy: async () => ({
        proxied: false,
        reason: 'manifest v3, this CLI speaks v4',
      }),
      print: (message) => output.push(message),
    }).exitOverride();

    await expect(incompatible.parseAsync([
      'create', 'compat', '--working-tree', '--kind', 'build', '--all',
      '--all-files', '--no-interactive',
    ], { from: 'user' })).rejects.toThrow(/Cannot verify the bisect lease.*Restart/s);
    expect(fs.existsSync(path.join(rootDir, 'bisect-repairs', 'compat.patch'))).toBe(false);
  });

  function command(interactive: boolean, prompt?: PatchPrompt) {
    return createBisectPatchCommand({
      resolveContext: async () => ({ configDirectory: rootDir, repoDir }),
      isInteractive: () => interactive,
      prompt,
      print: (message) => output.push(message),
    }).exitOverride();
  }

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
  }
});

class ScriptedPrompt implements PatchPrompt {
  constructor(private readonly script: { selects: string[]; inputs: string[] }) {}

  async select<T extends string>(): Promise<T> {
    return this.script.selects.shift() as T;
  }

  async input(): Promise<string> {
    return this.script.inputs.shift() ?? '';
  }

  async confirm(question: string): Promise<boolean> {
    return !question.startsWith('Add ');
  }
}

class DefaultsPrompt implements PatchPrompt {
  initialSelections: Array<string | undefined> = [];
  initialInputs: Array<string | undefined> = [];

  async select<T extends string>(_question: string, choices: readonly T[], initial?: T): Promise<T> {
    this.initialSelections.push(initial);
    return initial ?? choices[0]!;
  }

  async input(_question: string, initial = ''): Promise<string> {
    this.initialInputs.push(initial);
    return initial;
  }

  async confirm(question: string): Promise<boolean> {
    return !question.startsWith('Add ');
  }
}
