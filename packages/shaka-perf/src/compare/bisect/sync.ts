/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BuildManifest } from '../../twin-servers/helpers/rebuild-check';
import { exec } from '../../twin-servers/helpers/shell';

const MATERIALIZED_MARKER = '.shaka-bisect-materialized.json';

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
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
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
    if (pathExists(sourcePath)) assertExistingPathWithin(options.sourceDir, sourcePath);
    assertParentWithin(options.volumeDir, volumePath);
    owned.add(normalized);
  }
  return owned;
}

function removeOwnedPath(volumeDir: string, relativePath: string): void {
  const destinationPath = resolveWithin(volumeDir, relativePath);
  assertParentWithin(volumeDir, destinationPath);
  fs.rmSync(destinationPath, { recursive: true, force: true });
}

function validateSymlinkTarget(sourceDir: string, sourcePath: string, target: string): void {
  if (path.isAbsolute(target)) {
    throw new Error(`Symlink resolves outside source root: ${sourcePath}`);
  }
  const root = path.resolve(sourceDir);
  const resolvedTarget = path.resolve(path.dirname(sourcePath), target);
  if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Symlink resolves outside source root: ${sourcePath}`);
  }
}

function copyOwnedPath(sourceDir: string, volumeDir: string, relativePath: string): void {
  const sourcePath = resolveWithin(sourceDir, relativePath);
  const destinationPath = resolveWithin(volumeDir, relativePath);
  assertExistingPathWithin(sourceDir, sourcePath);
  assertParentWithin(volumeDir, destinationPath);
  const sourceStat = fs.lstatSync(sourcePath);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.rmSync(destinationPath, { recursive: true, force: true });

  if (sourceStat.isSymbolicLink()) {
    const target = fs.readlinkSync(sourcePath);
    validateSymlinkTarget(sourceDir, sourcePath, target);
    fs.symlinkSync(target, destinationPath);
    return;
  }
  if (!sourceStat.isFile()) {
    throw new Error(`Manifest path is not a file: ${relativePath}`);
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

function assertParentWithin(rootDir: string, candidatePath: string): void {
  let existingParent = path.dirname(candidatePath);
  while (!pathExists(existingParent)) {
    const parent = path.dirname(existingParent);
    if (parent === existingParent) {
      throw new Error(`Path resolves outside synchronization root: ${candidatePath}`);
    }
    existingParent = parent;
  }
  assertExistingPathWithin(rootDir, existingParent);
}

function writeMaterializedMarker(volumeDir: string, sha: string): void {
  fs.mkdirSync(volumeDir, { recursive: true });
  const markerPath = path.join(volumeDir, MATERIALIZED_MARKER);
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
  writeMaterializedMarker(options.volumeDir, options.candidateSha);
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

  writeMaterializedMarker(options.volumeDir, options.candidateSha);
}
