/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BuildManifest } from '../../twin-servers/helpers/rebuild-check';
import { exec } from '../../twin-servers/helpers/shell';

const SYNCED_CANDIDATE_MARKER = '.shaka-bisect-synced-candidate.json';

interface VolumeSyncOptions {
  sourceDir: string;
  volumeDir: string;
  manifest: BuildManifest;
  candidateSha: string;
}

export interface ReconcileExperimentVolumeOptions extends VolumeSyncOptions {}

export interface SyncCommitDeltaOptions extends VolumeSyncOptions {
  previousSha: string;
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath);
  if (
    !relativePath
    || path.isAbsolute(relativePath)
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
  ) {
    throw new Error(`Path resolves outside synchronization root: ${relativePath}`);
  }
  return normalized;
}

function resolveWithin(rootDir: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, ...normalized.split('/'));
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path resolves outside synchronization root: ${relativePath}`);
  }
  return resolved;
}

function manifestPaths(options: VolumeSyncOptions): Set<string> {
  const owned = new Set<string>();
  for (const manifestPath of options.manifest.files) {
    const normalized = normalizeRelativePath(manifestPath);
    const sourcePath = resolveWithin(options.sourceDir, normalized);
    const volumePath = resolveWithin(options.volumeDir, normalized);
    validateSourcePath(options.sourceDir, options.volumeDir, sourcePath, volumePath);
    assertParentWithin(options.volumeDir, volumePath);
    owned.add(normalized);
  }
  return owned;
}

function removeOwnedPath(volumeDir: string, relativePath: string): void {
  const destinationPath = resolveWithin(volumeDir, relativePath);
  assertParentWithin(volumeDir, destinationPath);
  removeDestinationFilePath(destinationPath);
}

function removeDestinationFilePath(destinationPath: string): void {
  let destinationStat: fs.Stats;
  try {
    destinationStat = fs.lstatSync(destinationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  if (destinationStat.isDirectory()) {
    if (fs.readdirSync(destinationPath).length > 0) {
      throw new Error(`Refusing to remove non-empty directory at manifest file path: ${destinationPath}`);
    }
    fs.rmdirSync(destinationPath);
    return;
  }
  fs.unlinkSync(destinationPath);
}

function validateSymlinkTarget(
  sourceDir: string,
  volumeDir: string,
  sourcePath: string,
  destinationPath: string,
  target: string,
): void {
  if (path.isAbsolute(target)) {
    throw new Error(`Symlink resolves outside source root: ${sourcePath}`);
  }
  const sourceTarget = path.resolve(path.dirname(sourcePath), target);
  const destinationTarget = path.resolve(path.dirname(destinationPath), target);
  assertLexicallyWithin(sourceDir, sourceTarget);
  assertLexicallyWithin(volumeDir, destinationTarget);
  assertExistingParentWithin(sourceDir, sourceTarget);
  if (pathExists(sourceTarget)) assertExistingPathWithin(sourceDir, sourceTarget);
  assertDestinationChain(volumeDir, destinationTarget, true);
}

function validateSourcePath(
  sourceDir: string,
  volumeDir: string,
  sourcePath: string,
  destinationPath: string,
): void {
  assertExistingParentWithin(sourceDir, sourcePath);
  if (!pathExists(sourcePath)) return;
  const sourceStat = fs.lstatSync(sourcePath);
  if (sourceStat.isSymbolicLink()) {
    validateSymlinkTarget(
      sourceDir,
      volumeDir,
      sourcePath,
      destinationPath,
      fs.readlinkSync(sourcePath),
    );
  } else {
    assertExistingPathWithin(sourceDir, sourcePath);
  }
}

function copyOwnedPath(sourceDir: string, volumeDir: string, relativePath: string): void {
  const sourcePath = resolveWithin(sourceDir, relativePath);
  const destinationPath = resolveWithin(volumeDir, relativePath);
  validateSourcePath(sourceDir, volumeDir, sourcePath, destinationPath);
  assertParentWithin(volumeDir, destinationPath);
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isFile() && !sourceStat.isSymbolicLink()) {
    throw new Error(`Manifest path is not a file: ${relativePath}`);
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  removeDestinationFilePath(destinationPath);

  if (sourceStat.isSymbolicLink()) {
    const target = fs.readlinkSync(sourcePath);
    validateSymlinkTarget(sourceDir, volumeDir, sourcePath, destinationPath, target);
    fs.symlinkSync(target, destinationPath);
    return;
  }

  fs.copyFileSync(sourcePath, destinationPath);
  fs.chmodSync(destinationPath, sourceStat.mode & 0o777);
}

function pathExists(relativePath: string): boolean {
  try {
    fs.lstatSync(relativePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertRealPathWithin(rootDir: string, realPath: string): void {
  const realRoot = fs.realpathSync(rootDir);
  if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Path resolves outside synchronization root: ${realPath}`);
  }
}

function assertExistingPathWithin(rootDir: string, candidatePath: string): void {
  assertRealPathWithin(rootDir, fs.realpathSync(candidatePath));
}

function assertLexicallyWithin(rootDir: string, candidatePath: string): void {
  const root = path.resolve(rootDir);
  const relativePath = path.relative(root, candidatePath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error(`Path resolves outside synchronization root: ${candidatePath}`);
  }
}

function assertExistingParentWithin(rootDir: string, candidatePath: string): void {
  assertLexicallyWithin(rootDir, candidatePath);
  let existingParent = path.dirname(candidatePath);
  while (!pathExists(existingParent)) existingParent = path.dirname(existingParent);
  assertExistingPathWithin(rootDir, existingParent);
}

function assertDestinationChain(
  rootDir: string,
  candidatePath: string,
  includeCandidate: boolean,
): void {
  assertLexicallyWithin(rootDir, candidatePath);
  const root = path.resolve(rootDir);
  const boundary = includeCandidate ? candidatePath : path.dirname(candidatePath);
  const relativeBoundary = path.relative(root, boundary);
  let current = root;
  const components = relativeBoundary.split(path.sep).filter(Boolean);
  for (const [index, component] of components.entries()) {
    current = path.join(current, component);
    if (!pathExists(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Destination parent chain could resolve outside synchronization root via symlink: ${current}`);
    }
    const isFinalCandidate = includeCandidate && index === components.length - 1;
    if (!isFinalCandidate && !stat.isDirectory()) {
      throw new Error(`Destination parent is not a directory: ${current}`);
    }
  }
}

function assertParentWithin(rootDir: string, candidatePath: string): void {
  assertDestinationChain(rootDir, candidatePath, false);
}

function writeSyncedCandidateMarker(volumeDir: string, sha: string): void {
  fs.mkdirSync(volumeDir, { recursive: true });
  const markerPath = path.join(volumeDir, SYNCED_CANDIDATE_MARKER);
  const temporaryPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify({ sha }), 'utf8');
    fs.renameSync(temporaryPath, markerPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export async function reconcileExperimentVolume(
  options: ReconcileExperimentVolumeOptions,
): Promise<void> {
  const owned = manifestPaths(options);
  for (const relativePath of owned) {
    const sourcePath = resolveWithin(options.sourceDir, relativePath);
    if (pathExists(sourcePath)) {
      copyOwnedPath(options.sourceDir, options.volumeDir, relativePath);
    } else {
      removeOwnedPath(options.volumeDir, relativePath);
    }
  }
  writeSyncedCandidateMarker(options.volumeDir, options.candidateSha);
}

function nextToken(tokens: string[], index: number, status: string): string {
  const token = tokens[index];
  if (!token) throw new Error(`Malformed git diff output for status ${status}`);
  return normalizeRelativePath(token);
}

export async function syncCommitDelta(options: SyncCommitDeltaOptions): Promise<void> {
  const owned = manifestPaths(options);
  const result = await exec('git', [
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies-harder',
    options.previousSha,
    options.candidateSha,
  ], { cwd: options.sourceDir, silent: true });
  if (result.code !== 0) {
    throw new Error(`Unable to calculate commit delta: ${result.stderr.trim()}`);
  }

  const tokens = result.stdout.split('\0');
  for (let index = 0; index < tokens.length && tokens[index];) {
    const status = tokens[index++];
    const operation = status[0];
    if (operation === 'R' || operation === 'C') {
      const sourcePath = nextToken(tokens, index++, status);
      const destinationPath = nextToken(tokens, index++, status);
      if (operation === 'R' && owned.has(sourcePath)) {
        removeOwnedPath(options.volumeDir, sourcePath);
      }
      if (owned.has(destinationPath)) {
        copyOwnedPath(options.sourceDir, options.volumeDir, destinationPath);
      }
      continue;
    }

    const relativePath = nextToken(tokens, index++, status);
    if (!owned.has(relativePath)) continue;
    if (operation === 'D') {
      removeOwnedPath(options.volumeDir, relativePath);
    } else if (operation === 'A' || operation === 'M' || operation === 'T') {
      copyOwnedPath(options.sourceDir, options.volumeDir, relativePath);
    } else {
      throw new Error(`Unsupported git diff status: ${status}`);
    }
  }

  writeSyncedCandidateMarker(options.volumeDir, options.candidateSha);
}
