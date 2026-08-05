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
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { Command, Option } from 'commander';
import { findAbTestsConfig, loadAbTestsConfig } from '../../config-loader';
import { buildAbTestsConfig } from '../../config';
import { resolveConfig } from '../../twin-servers/config';
import { tryProxy } from '../../twin-servers/ipc/client';
import { PROTOCOL_VERSION } from '../../twin-servers/ipc/protocol';
import {
  captureSourceCommitPatch,
  captureWorkingTreePatch,
  importPatchFile,
  type CapturedPatch,
} from './patch-capture';
import type { BisectPatchManifestEntry, BisectPatchSelector } from './patch-manifest';
import { BisectPatchRegistry, type PatchMetadata, type RegisteredPatch } from './patch-registry';

export interface PatchCliContext {
  configDirectory: string;
  configuredManifestPath?: string;
  repoDir: string;
  projectSlug?: string;
}

export interface PatchPrompt {
  select<T extends string>(question: string, choices: readonly T[], initial?: T): Promise<T>;
  input(question: string, initial?: string): Promise<string>;
  confirm(question: string, initial?: boolean): Promise<boolean>;
}

export interface BisectPatchCliDependencies {
  resolveContext?: (configPath?: string) => Promise<PatchCliContext>;
  prompt?: PatchPrompt;
  print?: (message: string) => void;
  isInteractive?: () => boolean;
  assertMutable?: (context: PatchCliContext) => Promise<void>;
}

interface SharedOptions {
  config?: string;
  json?: boolean;
  dryRun?: boolean;
  interactive?: boolean;
  yes?: boolean;
}

interface SourceOptions {
  workingTree?: boolean;
  sourceCommit?: string;
  patchFile?: string;
  parent?: string;
  root?: boolean;
  allFiles?: boolean;
}

interface MetadataOptions {
  kind?: BisectPatchManifestEntry['kind'];
  purpose?: string;
  all?: boolean;
  from?: string;
  through?: string;
  at?: string[];
  prepareCommand?: string[];
  prepareDescription?: string[];
  cleanupCommand?: string[];
  cleanupDescription?: string[];
}

export function createBisectPatchCommand(deps: BisectPatchCliDependencies = {}): Command {
  const patch = new Command('patch')
    .description('Create and manage compare-bisect compatibility patches')
    .option('--json', 'Emit machine-readable JSON', false)
    .option('--dry-run', 'Show intended changes without writing files', false)
    .option('--no-interactive', 'Fail instead of prompting for missing values')
    .option('--yes', 'Accept destructive confirmations', false);

  patch.addCommand(addCreateOptions(new Command('create')
    .description('Capture and register a new patch')
    .argument('<id>', 'Unique patch ID')
    .argument('[paths...]', 'Pathspecs used by working-tree or source-commit capture'))
    .action(async function (this: Command, id: string, paths: string[]) {
      await runCreate(id, paths, this.optsWithGlobals(), deps);
    }));

  patch.addCommand(new Command('list')
    .description('List registered patches')
    .option('--verbose', 'Include source, purpose, commands, and affected paths', false)
    .action(async function (this: Command) {
      const options = this.optsWithGlobals();
      const registry = await registryFor(options, deps);
      printPatchList(registry.list(), options.verbose === true, options.json === true, deps);
    }));

  patch.addCommand(new Command('show')
    .description('Show a registered patch')
    .argument('<id>', 'Patch ID')
    .option('--patch', 'Print complete patch contents', false)
    .action(async function (this: Command, id: string) {
      const options = this.optsWithGlobals();
      const registry = await registryFor(options, deps);
      const registered = registry.get(id);
      printPatch(registered, options.patch === true, options.json === true, deps);
    }));

  patch.addCommand(new Command('update')
    .description('Interactively review and update patch metadata')
    .argument('<id>', 'Patch ID')
    .action(async function (this: Command, id: string) {
      await runUpdate(id, this.optsWithGlobals(), deps);
    }));

  patch.addCommand(addSourceOptions(new Command('edit')
    .description('Replace patch contents from a supported source')
    .argument('<id>', 'Patch ID')
    .argument('[paths...]', 'Pathspecs used by working-tree or source-commit capture'))
    .action(async function (this: Command, id: string, paths: string[]) {
      await runEdit(id, paths, this.optsWithGlobals(), deps);
    }));

  patch.addCommand(new Command('apply')
    .description('Apply a registered patch to the experiment repository')
    .argument('<id>', 'Patch ID')
    .option('--check', 'Check applicability without changing files', false)
    .option('-R, --reverse', 'Reverse the registered patch', false)
    .action(async function (this: Command, id: string) {
      const options = this.optsWithGlobals();
      const context = await resolveContext(options.config, deps);
      await assertMutable(context, deps);
      const registry = new BisectPatchRegistry({ ...context });
      const outcome = registry.apply(id, {
        check: options.check === true || options.dryRun === true,
        reverse: options.reverse === true,
      });
      output({ id, outcome }, options.json === true, deps);
    }));

  patch.addCommand(new Command('verify')
    .description('Verify a registered patch against the current experiment HEAD')
    .argument('<id>', 'Patch ID')
    .argument('[good-ref]', 'Reserved concrete range lower endpoint')
    .argument('[bad-ref]', 'Reserved concrete range upper endpoint')
    .option('--investigate-merges', 'Include eligible merge candidates', false)
    .action(async function (this: Command, id: string, goodRef?: string, badRef?: string) {
      const options = this.optsWithGlobals();
      const registry = await registryFor(options, deps);
      const results = registry.verify(id, {
        goodRef,
        badRef,
        investigateMerges: options.investigateMerges === true,
      });
      output({ id, verified: true, results }, options.json === true, deps);
    }));

  patch.addCommand(new Command('remove')
    .description('Remove a patch registration and its managed artifact')
    .argument('<id>', 'Patch ID')
    .option('--keep-file', 'Remove only the manifest registration', false)
    .action(async function (this: Command, id: string) {
      await runRemove(id, this.optsWithGlobals(), deps);
    }));

  return patch;
}

function addCreateOptions(command: Command): Command {
  return addMetadataOptions(addSourceOptions(command));
}

function addSourceOptions(command: Command): Command {
  return command
    .option('--working-tree', 'Capture current uncommitted working-tree changes', false)
    .option('--source-commit <ref>', 'Capture changes introduced by a commit')
    .option('--patch-file <path>', 'Import an existing .patch file')
    .option('--parent <number>', 'Select a source merge parent')
    .option('--root', 'Permit capture of a root source commit', false)
    .option('--all-files', 'Capture the complete working tree', false);
}

function addMetadataOptions(command: Command): Command {
  return command
    .addOption(new Option('--kind <kind>', 'Patch kind').choices([
      'test-harness', 'build', 'data', 'other',
    ]))
    .option('--purpose <text>', 'Optional explanation for the patch')
    .option('--all', 'Apply to every commit evaluated by bisect', false)
    .option('--from <ref>', 'Inclusive first-parent interval lower bound')
    .option('--through <ref>', 'Inclusive first-parent interval upper bound')
    .option('--at <ref>', 'Apply at an exact commit; repeatable', collect, [])
    .option('--prepare-command <command>', 'Experiment preparation command; repeatable', collect, [])
    .option('--prepare-description <text>', 'Preparation command description; repeatable', collect, [])
    .option('--cleanup-command <command>', 'Experiment cleanup command; repeatable', collect, [])
    .option('--cleanup-description <text>', 'Cleanup command description; repeatable', collect, []);
}

async function runCreate(
  id: string,
  paths: string[],
  rawOptions: SharedOptions & SourceOptions & MetadataOptions,
  deps: BisectPatchCliDependencies,
): Promise<void> {
  const context = await resolveContext(rawOptions.config, deps);
  await assertMutable(context, deps);
  const interactive = shouldPrompt(rawOptions, deps);
  const answers = interactive
    ? await completeCreateAnswers(rawOptions, paths, deps.prompt ?? new ReadlinePatchPrompt())
    : { options: rawOptions, paths };
  const captured = capture(context.repoDir, answers.paths, answers.options);
  const metadata = metadataFromOptions(context.repoDir, answers.options);
  const preview = { id, metadata, source: captured.source, sha256: captured.sha256, files: captured.files };
  if (rawOptions.dryRun) return output({ dryRun: true, ...preview }, rawOptions.json === true, deps);
  if (interactive && !await (deps.prompt ?? new ReadlinePatchPrompt()).confirm('Create and verify this patch?', true)) {
    output({ id, canceled: true }, rawOptions.json === true, deps);
    return;
  }
  const registered = new BisectPatchRegistry({ ...context }).create(id, captured, metadata);
  outputRegistered('created', registered, rawOptions.json === true, deps);
}

async function runEdit(
  id: string,
  paths: string[],
  options: SharedOptions & SourceOptions,
  deps: BisectPatchCliDependencies,
): Promise<void> {
  const context = await resolveContext(options.config, deps);
  await assertMutable(context, deps);
  if (sourceCount(options) !== 1) throw sourceChoiceError();
  const captured = capture(context.repoDir, paths, options);
  if (options.dryRun) {
    output({ dryRun: true, id, source: captured.source, sha256: captured.sha256, files: captured.files }, options.json === true, deps);
    return;
  }
  const registered = new BisectPatchRegistry({ ...context }).edit(id, captured);
  outputRegistered('edited', registered, options.json === true, deps);
}

async function runUpdate(
  id: string,
  options: SharedOptions,
  deps: BisectPatchCliDependencies,
): Promise<void> {
  if (options.json || options.interactive === false || !(deps.isInteractive?.() ?? isInteractive())) {
    throw new Error('patch update requires an interactive TTY; it does not accept --json or --no-interactive');
  }
  const context = await resolveContext(options.config, deps);
  await assertMutable(context, deps);
  const registry = new BisectPatchRegistry({ ...context });
  const current = registry.get(id);
  const prompt = deps.prompt ?? new ReadlinePatchPrompt();
  output({ message: 'Patch contents are unchanged. Use `patch edit <id>` to replace them.' }, false, deps);
  const metadata = await promptMetadata(prompt, current.entry);
  if (!await prompt.confirm('Update this patch metadata?', true)) {
    output({ id, canceled: true }, false, deps);
    return;
  }
  if (options.dryRun) return output({ dryRun: true, id, metadata }, false, deps);
  outputRegistered('updated', registry.updateMetadata(id, metadata), false, deps);
}

async function runRemove(
  id: string,
  options: SharedOptions & { keepFile?: boolean },
  deps: BisectPatchCliDependencies,
): Promise<void> {
  const context = await resolveContext(options.config, deps);
  await assertMutable(context, deps);
  const registry = new BisectPatchRegistry({ ...context });
  const registered = registry.get(id);
  if (!options.yes) {
    if (!shouldPrompt(options, deps)) {
      throw new Error('patch remove requires --yes when not running interactively');
    }
    const confirmed = await (deps.prompt ?? new ReadlinePatchPrompt()).confirm(
      `Remove registration and ${registered.entry.filename}?`, false,
    );
    if (!confirmed) return output({ id, canceled: true }, options.json === true, deps);
  }
  if (!options.dryRun) registry.remove(id, options.keepFile === true);
  output({ id, removed: !options.dryRun, dryRun: options.dryRun === true }, options.json === true, deps);
}

function capture(repoDir: string, paths: string[], options: SourceOptions): CapturedPatch {
  if (sourceCount(options) !== 1) throw sourceChoiceError();
  if (options.patchFile) {
    if (paths.length > 0) throw new Error('--patch-file does not accept pathspecs after --');
    if (options.parent || options.root || options.allFiles) {
      throw new Error('--patch-file cannot be combined with --parent, --root, or --all-files');
    }
    return importPatchFile({ repoDir, patchFile: options.patchFile });
  }
  if (options.sourceCommit) {
    if (options.allFiles) throw new Error('--source-commit cannot be combined with --all-files');
    return captureSourceCommitPatch({
      repoDir,
      ref: options.sourceCommit,
      parent: options.parent === undefined ? undefined : parseParent(options.parent),
      root: options.root,
      paths,
    });
  }
  if (options.parent || options.root) {
    throw new Error('--working-tree cannot be combined with --parent or --root');
  }
  return captureWorkingTreePatch({ repoDir, paths, allFiles: options.allFiles });
}

function metadataFromOptions(repoDir: string, options: MetadataOptions): PatchMetadata {
  if (!options.kind) throw new Error('Missing patch kind; pass --kind <kind>');
  return {
    kind: options.kind,
    purpose: options.purpose,
    appliesTo: selectorFromOptions(repoDir, options),
    prepareCommands: pairCommands(options.prepareCommand, options.prepareDescription, 'prepare'),
    cleanupCommands: pairCommands(options.cleanupCommand, options.cleanupDescription, 'cleanup'),
  };
}

function selectorFromOptions(repoDir: string, options: MetadataOptions): BisectPatchSelector {
  const exact = options.at ?? [];
  const hasInterval = options.from !== undefined || options.through !== undefined;
  const count = Number(options.all === true) + Number(hasInterval) + Number(exact.length > 0);
  if (count !== 1) {
    throw new Error('Choose exactly one selector: --all, --through [with --from], or one or more --at');
  }
  if (options.all) return { all: true };
  if (exact.length > 0) return { commits: exact.map((ref) => resolveRef(repoDir, ref)) as [string, ...string[]] };
  if (!options.through) throw new Error('--from requires --through <ref>');
  return {
    ...(options.from ? { from: resolveRef(repoDir, options.from) } : {}),
    through: resolveRef(repoDir, options.through),
  };
}

function pairCommands(
  commands: string[] = [],
  descriptions: string[] = [],
  phase: string,
): BisectPatchManifestEntry['prepareCommands'] {
  if (descriptions.length > commands.length) {
    throw new Error(`More --${phase}-description values were supplied than --${phase}-command values`);
  }
  return commands.map((command, index) => ({
    command,
    description: descriptions[index] ?? command,
  }));
}

async function completeCreateAnswers(
  initial: SourceOptions & MetadataOptions,
  initialPaths: string[],
  prompt: PatchPrompt,
): Promise<{ options: SourceOptions & MetadataOptions; paths: string[] }> {
  const options = { ...initial };
  let paths = [...initialPaths];
  if (sourceCount(options) === 0) {
    const source = await prompt.select('Patch source', ['working-tree', 'source-commit', 'patch-file']);
    if (source === 'working-tree') options.workingTree = true;
    if (source === 'source-commit') options.sourceCommit = await prompt.input('Source commit ref', 'HEAD');
    if (source === 'patch-file') options.patchFile = await prompt.input('Existing .patch file path');
  } else if (sourceCount(options) > 1) {
    throw sourceChoiceError();
  }
  if (options.workingTree && paths.length === 0 && !options.allFiles) {
    const selection = await prompt.input('Paths to capture (comma-separated; none selected by default)');
    paths = splitValues(selection);
  }
  if (!options.kind) {
    options.kind = await prompt.select(
      'Patch kind', ['test-harness', 'build', 'data', 'other'] as const,
    );
  }
  if (selectorCount(options) === 0) {
    const selector = await prompt.select('Where should this patch apply?', ['all', 'interval', 'commits'], 'all');
    if (selector === 'all') options.all = true;
    if (selector === 'interval') {
      options.from = (await prompt.input('Inclusive lower ref (blank uses session good SHA)')) || undefined;
      options.through = await prompt.input('Inclusive upper ref');
    }
    if (selector === 'commits') options.at = splitValues(await prompt.input('Exact refs (comma-separated)'));
  }
  if (options.purpose === undefined) options.purpose = await prompt.input('Purpose (optional)');
  const prepareCommands = await promptCommandList(
    prompt,
    'preparation',
    pairCommands(options.prepareCommand, options.prepareDescription, 'prepare'),
  );
  options.prepareCommand = prepareCommands.map((command) => command.command);
  options.prepareDescription = prepareCommands.map((command) => command.description);
  const cleanupCommands = await promptCommandList(
    prompt,
    'cleanup',
    pairCommands(options.cleanupCommand, options.cleanupDescription, 'cleanup'),
  );
  options.cleanupCommand = cleanupCommands.map((command) => command.command);
  options.cleanupDescription = cleanupCommands.map((command) => command.description);
  return { options, paths };
}

async function promptMetadata(
  prompt: PatchPrompt,
  current: BisectPatchManifestEntry,
): Promise<PatchMetadata> {
  const kind = await prompt.select(
    'Patch kind', ['test-harness', 'build', 'data', 'other'], current.kind,
  );
  const purpose = await prompt.input('Purpose (optional)', current.purpose ?? '');
  const selectorKind = 'all' in current.appliesTo
    ? 'all'
    : 'commits' in current.appliesTo ? 'commits' : 'interval';
  const selected = await prompt.select(
    'Where should this patch apply?', ['all', 'interval', 'commits'], selectorKind,
  );
  let appliesTo: BisectPatchSelector;
  if (selected === 'all') appliesTo = { all: true };
  else if (selected === 'commits') {
    const initial = 'commits' in current.appliesTo ? current.appliesTo.commits.join(', ') : '';
    const commits = splitValues(await prompt.input('Exact commit SHAs (comma-separated)', initial));
    if (commits.length === 0) throw new Error('At least one exact commit is required');
    appliesTo = { commits: commits as [string, ...string[]] };
  } else {
    const interval = 'through' in current.appliesTo ? current.appliesTo : { through: '' };
    const from = await prompt.input('Inclusive lower SHA (blank uses session good SHA)', interval.from ?? '');
    const through = await prompt.input('Inclusive upper SHA', interval.through);
    appliesTo = { ...(from ? { from } : {}), through };
  }
  const prepareCommands = await promptCommandList(prompt, 'preparation', current.prepareCommands);
  const cleanupCommands = await promptCommandList(prompt, 'cleanup', current.cleanupCommands);
  return {
    kind,
    purpose,
    appliesTo,
    prepareCommands,
    cleanupCommands,
  };
}

async function promptCommandList(
  prompt: PatchPrompt,
  phase: 'preparation' | 'cleanup',
  current: BisectPatchManifestEntry['prepareCommands'],
): Promise<BisectPatchManifestEntry['prepareCommands']> {
  const commands = [];
  for (const [index, existing] of current.entries()) {
    const command = await prompt.input(`${phase} command ${index + 1}`, existing.command);
    if (!command) continue;
    const description = await prompt.input(
      `${phase} command ${index + 1} description (optional)`, existing.description,
    );
    commands.push({ command, description: description || command });
  }
  while (await prompt.confirm(`Add ${phase} command?`, false)) {
    const command = await prompt.input(`${phase} command`);
    if (!command) throw new Error(`${phase} command cannot be empty`);
    const description = await prompt.input(`${phase} command description (optional)`);
    commands.push({ command, description: description || command });
  }
  return commands;
}

async function registryFor(options: SharedOptions, deps: BisectPatchCliDependencies) {
  return new BisectPatchRegistry({ ...await resolveContext(options.config, deps) });
}

async function resolveContext(
  configPath: string | undefined,
  deps: BisectPatchCliDependencies,
): Promise<PatchCliContext> {
  if (deps.resolveContext) return deps.resolveContext(configPath);
  const resolvedConfigPath = configPath ? path.resolve(configPath) : findAbTestsConfig();
  if (!resolvedConfigPath) {
    throw new Error('No abtests.config.ts found; pass --config <path>');
  }
  const raw = await loadAbTestsConfig(resolvedConfigPath);
  const config = buildAbTestsConfig(raw);
  if (!config.twinServers) throw new Error('Patch management requires a twinServers section');
  const twinServers = resolveConfig(config.twinServers, process.cwd());
  return {
    configDirectory: path.dirname(resolvedConfigPath),
    configuredManifestPath: config.bisect.patchesManifest,
    repoDir: twinServers.experimentDir,
    projectSlug: twinServers.projectSlug,
  };
}

async function assertMutable(
  context: PatchCliContext,
  deps: BisectPatchCliDependencies,
): Promise<void> {
  if (deps.assertMutable) return deps.assertMutable(context);
  if (!context.projectSlug) return;
  const outcome = await tryProxy({
    slug: context.projectSlug,
    request: { v: PROTOCOL_VERSION, cmd: 'bisect-status' },
  });
  if (outcome.proxied && outcome.code !== 0) {
    throw new Error(outcome.error ?? 'Cannot query compare-bisect lease status');
  }
  const activeSessionId = outcome.proxied
    ? (outcome.data as { activeSessionId?: string | null } | undefined)?.activeSessionId
    : null;
  if (activeSessionId) {
    throw new Error(
      `Cannot modify compare-bisect patches while session "${activeSessionId}" owns the project`,
    );
  }
}

function printPatchList(
  patches: RegisteredPatch[],
  verbose: boolean,
  json: boolean,
  deps: BisectPatchCliDependencies,
): void {
  if (json) return output(patches.map((patch) => ({ ...patch.entry, hashValid: patch.hashValid, files: patch.files })), true, deps);
  if (patches.length === 0) return output('No compare-bisect patches registered.', false, deps);
  for (const patch of patches) {
    output(`${patch.entry.id}\t${patch.entry.kind}\t${formatSelector(patch.entry.appliesTo)}\t${patch.entry.sha256.slice(0, 12)}\t${patch.hashValid ? 'verified' : 'HASH MISMATCH'}`, false, deps);
    if (verbose) output(JSON.stringify({ purpose: patch.entry.purpose, source: patch.entry.source, files: patch.files, prepareCommands: patch.entry.prepareCommands, cleanupCommands: patch.entry.cleanupCommands }), false, deps);
  }
}

function printPatch(
  patch: RegisteredPatch,
  includeBytes: boolean,
  json: boolean,
  deps: BisectPatchCliDependencies,
): void {
  if (json) return output({ ...patch.entry, artifactPath: patch.artifactPath, hashValid: patch.hashValid, files: patch.files }, true, deps);
  output(JSON.stringify({ ...patch.entry, artifactPath: patch.artifactPath, hashValid: patch.hashValid, files: patch.files }, null, 2), false, deps);
  if (includeBytes) output(fs.readFileSync(patch.artifactPath, 'utf8'), false, deps);
}

function outputRegistered(
  action: string,
  patch: RegisteredPatch,
  json: boolean,
  deps: BisectPatchCliDependencies,
): void {
  output(json ? { action, ...patch.entry, files: patch.files } : `${action} patch "${patch.entry.id}" (${patch.entry.sha256.slice(0, 12)})`, json, deps);
}

function output(value: unknown, json: boolean, deps: BisectPatchCliDependencies): void {
  const message = typeof value === 'string' && !json ? value : JSON.stringify(value, null, json ? 0 : 2);
  (deps.print ?? console.log)(message);
}

function formatSelector(selector: BisectPatchSelector): string {
  if ('all' in selector) return 'all';
  if ('commits' in selector) return selector.commits.join(',');
  return `${selector.from ?? '<good>'}..${selector.through}`;
}

function resolveRef(repoDir: string, ref: string): string {
  return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim();
}

function sourceCount(options: SourceOptions): number {
  return Number(options.workingTree === true)
    + Number(options.sourceCommit !== undefined)
    + Number(options.patchFile !== undefined);
}

function selectorCount(options: MetadataOptions): number {
  return Number(options.all === true)
    + Number(options.from !== undefined || options.through !== undefined)
    + Number((options.at?.length ?? 0) > 0);
}

function sourceChoiceError(): Error {
  return new Error(
    'Choose exactly one patch source:\n  --working-tree\n  --source-commit <ref>\n  --patch-file <path>',
  );
}

function parseParent(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('--parent must be a positive integer');
  return parsed;
}

function splitValues(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function shouldPrompt(options: SharedOptions, deps: BisectPatchCliDependencies): boolean {
  if (options.json || options.interactive === false) return false;
  return deps.isInteractive?.() ?? isInteractive();
}

function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

class ReadlinePatchPrompt implements PatchPrompt {
  async select<T extends string>(question: string, choices: readonly T[], initial?: T): Promise<T> {
    const defaultIndex = Math.max(0, initial ? choices.indexOf(initial) : 0);
    const lines = choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n');
    const answer = await this.input(`${question}\n${lines}\nChoose`, String(defaultIndex + 1));
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || !choices[index]) throw new Error(`Invalid choice for ${question}`);
    return choices[index]!;
  }

  async input(question: string, initial = ''): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const suffix = initial ? ` [${initial}]` : '';
      const answer = await rl.question(`? ${question}${suffix}: `);
      return answer.trim() || initial;
    } finally {
      rl.close();
    }
  }

  async confirm(question: string, initial = false): Promise<boolean> {
    const answer = (await this.input(`${question} (${initial ? 'Y/n' : 'y/N'})`)).toLowerCase();
    return answer === '' ? initial : answer === 'y' || answer === 'yes';
  }
}
