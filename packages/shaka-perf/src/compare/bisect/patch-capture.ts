/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultCopyIgnoreConfig } from '../../twin-servers/copy-ignore-defaults';
import {
  createCopyIgnoreMatcher,
  isCopyIgnored,
} from '../../twin-servers/helpers/copy-ignore';
import type { CopyIgnoreConfig } from '../../twin-servers/types';
import type { BisectPatchSource } from './patch-manifest';

const MAX_GIT_OUTPUT = 100 * 1024 * 1024;
const FORBIDDEN_TARGET_PARTS = new Set([
  '.git',
  'node_modules',
  'compare-results',
  'compare-bisect-results',
]);

export interface PatchFileSummary {
  path: string;
  added: number | null;
  deleted: number | null;
}

export interface CapturedPatch {
  bytes: Buffer;
  files: PatchFileSummary[];
  sha256: string;
  source: BisectPatchSource;
}

export function captureWorkingTreePatch(options: {
  repoDir: string;
  paths?: readonly string[];
  allFiles?: boolean;
  copyIgnore?: CopyIgnoreConfig;
}): CapturedPatch {
  if ((options.paths?.length ?? 0) === 0 && !options.allFiles) {
    throw new Error('Working-tree capture requires pathspecs after -- or explicit --all-files');
  }
  const repoDir = gitRoot(options.repoDir);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-index-'));
  const temporaryIndex = path.join(temporaryDirectory, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
  try {
    git(repoDir, ['read-tree', 'HEAD'], { env });
    const addArgs = ['add', '-A'];
    if (!options.allFiles) addArgs.push('--', ...options.paths!);
    git(repoDir, addArgs, { env });
    unstageCopyIgnored(repoDir, env, options.copyIgnore ?? defaultCopyIgnoreConfig());
    const diffArgs = ['diff', '--cached', '--binary', '--full-index', 'HEAD'];
    if (!options.allFiles) diffArgs.push('--', ...options.paths!);
    const bytes = gitBuffer(repoDir, diffArgs, { env });
    return finishCapture(repoDir, bytes, (files) => ({
      kind: 'working-tree',
      headSha: git(repoDir, ['rev-parse', 'HEAD']),
      paths: files.map((file) => file.path) as [string, ...string[]],
    }), options.copyIgnore);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function captureSourceCommitPatch(options: {
  repoDir: string;
  ref: string;
  parent?: number;
  root?: boolean;
  paths?: readonly string[];
  copyIgnore?: CopyIgnoreConfig;
}): CapturedPatch {
  if (options.root && options.parent !== undefined) {
    throw new Error('--root cannot be combined with --parent');
  }
  const repoDir = gitRoot(options.repoDir);
  const sha = git(repoDir, ['rev-parse', '--verify', `${options.ref}^{commit}`]);
  const parentShas = git(repoDir, ['rev-list', '--parents', '-n', '1', sha])
    .split(/\s+/).slice(1);
  let parentSha: string;
  if (parentShas.length === 0) {
    if (!options.root) {
      throw new Error(`Source commit ${sha} is a root commit; pass --root to capture it`);
    }
    parentSha = gitBuffer(repoDir, ['hash-object', '-t', 'tree', '--stdin'], { input: Buffer.alloc(0) })
      .toString('utf8').trim();
  } else {
    if (options.root) throw new Error('--root is only valid for a root source commit');
    const parentNumber = options.parent ?? 1;
    if (!Number.isSafeInteger(parentNumber) || parentNumber < 1 || parentNumber > parentShas.length) {
      throw new Error(
        `Source commit ${sha} has ${parentShas.length} parent(s); --parent must be between 1 and ${parentShas.length}`,
      );
    }
    parentSha = parentShas[parentNumber - 1]!;
  }
  const namesArgs = ['diff', '--name-only', '-z', parentSha, sha];
  if (options.paths?.length) namesArgs.push('--', ...options.paths);
  const matcher = createCopyIgnoreMatcher(options.copyIgnore ?? defaultCopyIgnoreConfig());
  const includedPaths = gitBuffer(repoDir, namesArgs).toString('utf8')
    .split('\0').filter(Boolean)
    .filter((file) => !isCopyIgnored(matcher, file));
  const args = ['diff', '--binary', '--full-index', parentSha, sha, '--', ...includedPaths];
  const bytes = includedPaths.length > 0 ? gitBuffer(repoDir, args) : Buffer.alloc(0);
  return finishCapture(repoDir, bytes, (files) => ({
    kind: 'source-commit',
    sha,
    parentSha,
    paths: files.map((file) => file.path),
  }), options.copyIgnore);
}

export function importPatchFile(options: {
  repoDir: string;
  patchFile: string;
  copyIgnore?: CopyIgnoreConfig;
}): CapturedPatch {
  const repoDir = gitRoot(options.repoDir);
  const sourcePath = path.resolve(options.patchFile);
  const stat = fs.statSync(sourcePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw new Error(`Patch source must be a readable regular file: ${sourcePath}`);
  }
  const bytes = fs.readFileSync(sourcePath);
  return finishCapture(repoDir, bytes, {
    kind: 'patch-file',
    importedFromBasename: path.basename(sourcePath),
  }, options.copyIgnore);
}

export function inspectPatch(
  repoDir: string,
  bytes: Buffer,
  copyIgnore: CopyIgnoreConfig = defaultCopyIgnoreConfig(),
): PatchFileSummary[] {
  return inspectPatchAtRoot(gitRoot(repoDir), bytes, copyIgnore);
}

export function inspectPatchAtRoot(
  repoRoot: string,
  bytes: Buffer,
  copyIgnore: CopyIgnoreConfig = defaultCopyIgnoreConfig(),
): PatchFileSummary[] {
  if (bytes.length === 0) throw new Error('Patch capture is empty');
  let output: Buffer;
  try {
    output = gitBuffer(repoRoot, ['apply', '--numstat', '-z', '--binary', '-'], { input: bytes });
  } catch (error) {
    throw new Error('Patch is not a valid git apply patch', { cause: error });
  }
  const files = parseNumstat(output);
  if (files.length === 0) throw new Error('Patch does not contain any file changes');
  const copyIgnoreMatcher = createCopyIgnoreMatcher(copyIgnore);
  for (const file of files) {
    validateTargetPath(file.path);
    if (isCopyIgnored(copyIgnoreMatcher, file.path)) {
      throw new Error(`Patch targets configured copy-ignore path: ${file.path}`);
    }
  }
  return files;
}

function finishCapture(
  repoDir: string,
  bytes: Buffer,
  source: BisectPatchSource | ((files: PatchFileSummary[]) => BisectPatchSource),
  copyIgnore?: CopyIgnoreConfig,
): CapturedPatch {
  const files = inspectPatch(repoDir, bytes, copyIgnore);
  return {
    bytes,
    files,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: typeof source === 'function' ? source(files) : source,
  };
}

function unstageCopyIgnored(
  repoDir: string,
  env: NodeJS.ProcessEnv,
  copyIgnore: CopyIgnoreConfig,
): void {
  const changed = gitBuffer(repoDir, ['diff', '--cached', '--name-only', '-z'], { env })
    .toString('utf8').split('\0').filter(Boolean);
  const matcher = createCopyIgnoreMatcher(copyIgnore);
  const ignored = changed.filter((file) => isCopyIgnored(matcher, file));
  if (ignored.length > 0) git(repoDir, ['reset', 'HEAD', '--', ...ignored], { env });
}

function parseNumstat(output: Buffer): PatchFileSummary[] {
  return output.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('Patch contains an unreadable file summary');
    return {
      added: match[1] === '-' ? null : Number(match[1]),
      deleted: match[2] === '-' ? null : Number(match[2]),
      path: match[3]!,
    };
  });
}

function validateTargetPath(target: string): void {
  const normalized = target.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (
    path.posix.isAbsolute(normalized)
    || parts.includes('..')
    || parts.some((part) => FORBIDDEN_TARGET_PARTS.has(part))
  ) {
    throw new Error(`Patch targets forbidden or unsafe path: ${target}`);
  }
}

function gitRoot(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

function git(
  cwd: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): string {
  return gitBuffer(cwd, args, options).toString('utf8').trim();
}

function gitBuffer(
  cwd: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: Buffer } = {},
): Buffer {
  return execFileSync('git', args, {
    cwd,
    env: options.env,
    input: options.input,
    maxBuffer: MAX_GIT_OUTPUT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
