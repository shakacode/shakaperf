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
import * as path from 'node:path';
import type { CapturedPatch, PatchFileSummary } from './patch-capture';
import { inspectPatch } from './patch-capture';
import {
  BisectPatchManifestSchema,
  loadBisectPatchManifest,
  type BisectPatchManifest,
  type BisectPatchManifestEntry,
  type BisectPatchSelector,
} from './patch-manifest';

export interface PatchMetadata {
  kind: BisectPatchManifestEntry['kind'];
  purpose?: string;
  appliesTo: BisectPatchSelector;
  prepareCommands?: BisectPatchManifestEntry['prepareCommands'];
  cleanupCommands?: BisectPatchManifestEntry['cleanupCommands'];
}

export interface PatchRegistryOptions {
  configDirectory: string;
  configuredManifestPath?: string;
  repoDir: string;
}

export interface RegisteredPatch {
  entry: BisectPatchManifestEntry;
  artifactPath: string;
  files: PatchFileSummary[];
  hashValid: boolean;
}

export type PatchApplyOutcome = 'applied' | 'reversed' | 'applicable' | 'already-native';

export class BisectPatchRegistry {
  constructor(private readonly options: PatchRegistryOptions) {}

  list(): RegisteredPatch[] {
    const loaded = this.load();
    return loaded.manifest.patches.map((entry) => this.describe(entry, loaded.directory));
  }

  get(id: string): RegisteredPatch {
    const loaded = this.load();
    const entry = loaded.manifest.patches.find((patch) => patch.id === id);
    if (!entry) throw new Error(`Unknown compare-bisect patch "${id}"`);
    return this.describe(entry, loaded.directory);
  }

  create(id: string, captured: CapturedPatch, metadata: PatchMetadata): RegisteredPatch {
    validatePatchId(id);
    const loaded = this.load();
    if (loaded.manifest.patches.some((patch) => patch.id === id)) {
      throw new Error(`Compare-bisect patch "${id}" already exists`);
    }
    const filename = `${id}.patch`;
    if (loaded.manifest.patches.some((patch) => patch.filename === filename)) {
      throw new Error(`Compare-bisect patch artifact "${filename}" is already registered`);
    }
    const entry = normalizeEntry({
      id,
      filename,
      sha256: captured.sha256,
      source: captured.source,
      ...metadata,
    });
    const manifest = parseManifest({
      version: 1,
      patches: [...loaded.manifest.patches, entry],
    });
    writeCreateTransaction(loaded.path, loaded.directory, entry, captured.bytes, manifest);
    return this.describe(entry, loaded.directory);
  }

  updateMetadata(id: string, metadata: PatchMetadata): RegisteredPatch {
    const loaded = this.load();
    const index = loaded.manifest.patches.findIndex((patch) => patch.id === id);
    if (index < 0) throw new Error(`Unknown compare-bisect patch "${id}"`);
    const entry = normalizeEntry({ ...loaded.manifest.patches[index]!, ...metadata });
    const patches = [...loaded.manifest.patches];
    patches[index] = entry;
    writeManifestAtomic(loaded.path, parseManifest({ version: 1, patches }));
    return this.describe(entry, loaded.directory);
  }

  edit(id: string, captured: CapturedPatch): RegisteredPatch {
    const loaded = this.load();
    const index = loaded.manifest.patches.findIndex((patch) => patch.id === id);
    if (index < 0) throw new Error(`Unknown compare-bisect patch "${id}"`);
    const current = loaded.manifest.patches[index]!;
    const entry = normalizeEntry({
      ...current,
      sha256: captured.sha256,
      source: captured.source,
    });
    const patches = [...loaded.manifest.patches];
    patches[index] = entry;
    const manifest = parseManifest({ version: 1, patches });
    replaceArtifactTransaction(loaded.path, loaded.directory, entry, captured.bytes, manifest);
    return this.describe(entry, loaded.directory);
  }

  remove(id: string, keepFile = false): void {
    const loaded = this.load();
    const entry = loaded.manifest.patches.find((patch) => patch.id === id);
    if (!entry) throw new Error(`Unknown compare-bisect patch "${id}"`);
    const patches = loaded.manifest.patches.filter((patch) => patch.id !== id);
    if (!keepFile && patches.some((patch) => patch.filename === entry.filename)) {
      throw new Error(`Cannot remove shared patch artifact "${entry.filename}"`);
    }
    const manifest = parseManifest({ version: 1, patches });
    removeTransaction(loaded.path, loaded.directory, entry, manifest, keepFile);
  }

  apply(id: string, options: { check?: boolean; reverse?: boolean } = {}): PatchApplyOutcome {
    const patch = this.get(id);
    if (!patch.hashValid) {
      throw new Error(`Compare-bisect patch "${id}" artifact hash does not match the manifest`);
    }
    const repoDir = gitRoot(this.options.repoDir);
    const bytes = fs.readFileSync(patch.artifactPath);
    const reverse = options.reverse === true;
    if (!reverse && !canApply(repoDir, bytes, false)) {
      const clean = isClean(repoDir);
      if (clean && canApply(repoDir, bytes, true)) return 'already-native';
      if (!clean && canApply(repoDir, bytes, true)) {
        throw new Error(
          `Patch "${id}" appears in uncommitted working-tree changes; clean the repository first`,
        );
      }
      throw new Error(`Patch "${id}" does not apply cleanly to ${repoDir}`);
    }
    if (reverse && !canApply(repoDir, bytes, true)) {
      throw new Error(`Patch "${id}" cannot be reversed cleanly from ${repoDir}`);
    }
    if (options.check) return 'applicable';
    gitApply(repoDir, bytes, reverse, false);
    return reverse ? 'reversed' : 'applied';
  }

  private load() {
    return loadBisectPatchManifest({
      configDirectory: this.options.configDirectory,
      configuredPath: this.options.configuredManifestPath,
    });
  }

  private describe(entry: BisectPatchManifestEntry, directory: string): RegisteredPatch {
    const artifactPath = path.join(directory, entry.filename);
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(artifactPath);
    } catch (error) {
      throw new Error(`Cannot read compare-bisect patch "${entry.id}" at ${artifactPath}`, {
        cause: error,
      });
    }
    return {
      entry,
      artifactPath,
      files: inspectPatch(this.options.repoDir, bytes),
      hashValid: createHash('sha256').update(bytes).digest('hex') === entry.sha256,
    };
  }
}

function normalizeEntry(
  entry: Omit<BisectPatchManifestEntry, 'prepareCommands' | 'cleanupCommands'> & {
    prepareCommands?: BisectPatchManifestEntry['prepareCommands'];
    cleanupCommands?: BisectPatchManifestEntry['cleanupCommands'];
  },
): BisectPatchManifestEntry {
  const normalized = {
    ...entry,
    prepareCommands: entry.prepareCommands ?? [],
    cleanupCommands: entry.cleanupCommands ?? [],
  };
  const purpose = entry.purpose?.trim();
  if (purpose) return { ...normalized, purpose };
  const { purpose: _purpose, ...withoutPurpose } = normalized;
  return withoutPurpose;
}

function validatePatchId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error('Patch id must be a filesystem-safe identifier');
  }
}

function parseManifest(value: unknown): BisectPatchManifest {
  const result = BisectPatchManifestSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid compare-bisect patch: ${result.error.errors[0]!.message}`);
  return result.data;
}

function writeCreateTransaction(
  manifestPath: string,
  directory: string,
  entry: BisectPatchManifestEntry,
  bytes: Buffer,
  manifest: BisectPatchManifest,
): void {
  fs.mkdirSync(directory, { recursive: true });
  const artifactPath = path.join(directory, entry.filename);
  if (fs.existsSync(artifactPath)) throw new Error(`Patch artifact already exists: ${artifactPath}`);
  const artifactTemporary = temporaryPath(artifactPath);
  const manifestTemporary = temporaryPath(manifestPath);
  try {
    fs.writeFileSync(artifactTemporary, bytes, { flag: 'wx' });
    writeManifestFile(manifestTemporary, manifest);
    fs.renameSync(artifactTemporary, artifactPath);
    try {
      fs.renameSync(manifestTemporary, manifestPath);
    } catch (error) {
      fs.rmSync(artifactPath, { force: true });
      throw error;
    }
  } finally {
    fs.rmSync(artifactTemporary, { force: true });
    fs.rmSync(manifestTemporary, { force: true });
  }
}

function replaceArtifactTransaction(
  manifestPath: string,
  directory: string,
  entry: BisectPatchManifestEntry,
  bytes: Buffer,
  manifest: BisectPatchManifest,
): void {
  const artifactPath = path.join(directory, entry.filename);
  const artifactTemporary = temporaryPath(artifactPath);
  const manifestTemporary = temporaryPath(manifestPath);
  const original = fs.readFileSync(artifactPath);
  try {
    fs.writeFileSync(artifactTemporary, bytes, { flag: 'wx' });
    writeManifestFile(manifestTemporary, manifest);
    fs.renameSync(artifactTemporary, artifactPath);
    try {
      fs.renameSync(manifestTemporary, manifestPath);
    } catch (error) {
      fs.writeFileSync(artifactTemporary, original, { flag: 'wx' });
      fs.renameSync(artifactTemporary, artifactPath);
      throw error;
    }
  } finally {
    fs.rmSync(artifactTemporary, { force: true });
    fs.rmSync(manifestTemporary, { force: true });
  }
}

function removeTransaction(
  manifestPath: string,
  directory: string,
  entry: BisectPatchManifestEntry,
  manifest: BisectPatchManifest,
  keepFile: boolean,
): void {
  const artifactPath = path.join(directory, entry.filename);
  const heldArtifact = temporaryPath(artifactPath);
  const manifestTemporary = temporaryPath(manifestPath);
  try {
    if (!keepFile) fs.renameSync(artifactPath, heldArtifact);
    writeManifestFile(manifestTemporary, manifest);
    try {
      fs.renameSync(manifestTemporary, manifestPath);
    } catch (error) {
      if (!keepFile) fs.renameSync(heldArtifact, artifactPath);
      throw error;
    }
    if (!keepFile) fs.rmSync(heldArtifact, { force: true });
  } finally {
    fs.rmSync(manifestTemporary, { force: true });
  }
}

function writeManifestAtomic(manifestPath: string, manifest: BisectPatchManifest): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temporary = temporaryPath(manifestPath);
  try {
    writeManifestFile(temporary, manifest);
    fs.renameSync(temporary, manifestPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function writeManifestFile(file: string, manifest: BisectPatchManifest): void {
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}

function temporaryPath(file: string): string {
  return `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
}

function gitRoot(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function isClean(repoDir: string): boolean {
  return execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf8' }).trim() === '';
}

function canApply(repoDir: string, bytes: Buffer, reverse: boolean): boolean {
  try {
    gitApply(repoDir, bytes, reverse, true);
    return true;
  } catch {
    return false;
  }
}

function gitApply(repoDir: string, bytes: Buffer, reverse: boolean, check: boolean): void {
  const args = ['apply', '--binary'];
  if (check) args.push('--check');
  if (reverse) args.push('--reverse');
  args.push('-');
  execFileSync('git', args, {
    cwd: repoDir,
    input: bytes,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
