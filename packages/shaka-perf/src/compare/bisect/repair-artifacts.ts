/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BisectRepairConfig } from '../../config';
import { resolveCommit, type PreparedGitRange } from './git';
import type { BisectRepair } from './types';

export interface PreparedBisectRepairArtifact {
  filename: string;
  contents: Buffer;
}

export interface PreparedBisectRepairSet {
  repairs: BisectRepair[];
  artifacts: PreparedBisectRepairArtifact[];
}

export async function prepareConfiguredRepairs(options: {
  repairs: readonly BisectRepairConfig[];
  configDirectory: string;
  experimentDir: string;
  range: PreparedGitRange;
  registeredAt: string;
  rebuildContainer: boolean;
}): Promise<PreparedBisectRepairSet> {
  const repairs: BisectRepair[] = [];
  const artifacts: PreparedBisectRepairArtifact[] = [];

  for (const [order, configured] of options.repairs.entries()) {
    validateDataRepair(configured, options.rebuildContainer);
    const sourcePath = path.resolve(options.configDirectory, configured.patch);
    let contents: Buffer;
    try {
      contents = fs.readFileSync(sourcePath);
    } catch (error) {
      throw new Error(`Cannot read bisect repair "${configured.id}" at ${sourcePath}`, {
        cause: error,
      });
    }
    if (contents.length === 0) {
      throw new Error(`Bisect repair "${configured.id}" patch is empty`);
    }
    const filename = `patches/${configured.id}.patch`;
    repairs.push({
      id: configured.id,
      kind: configured.kind,
      purpose: configured.purpose,
      filename,
      sha256: hash(contents),
      order,
      applicableShas: await resolveApplicableShas(
        configured,
        options.experimentDir,
        options.range,
      ),
      prepareCommands: configured.prepareCommands.map((command) => ({ ...command })),
      cleanupCommands: configured.cleanupCommands.map((command) => ({ ...command })),
      registeredAt: options.registeredAt,
      source: 'config',
    });
    artifacts.push({ filename, contents });
  }

  return { repairs, artifacts };
}

export function writePreparedRepairArtifacts(
  resultsDirectory: string,
  artifacts: readonly PreparedBisectRepairArtifact[],
): void {
  const patchesDirectory = path.join(resultsDirectory, 'patches');
  fs.rmSync(patchesDirectory, { recursive: true, force: true });
  if (artifacts.length === 0) return;
  fs.mkdirSync(patchesDirectory, { recursive: true });
  for (const artifact of artifacts) {
    const destination = repairArtifactPath(resultsDirectory, artifact.filename);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, artifact.contents);
    fs.renameSync(temporary, destination);
  }
}

export function verifyPersistedRepairArtifacts(
  resultsDirectory: string,
  repairs: readonly BisectRepair[],
): void {
  for (const repair of repairs) {
    const artifactPath = repairArtifactPath(resultsDirectory, repair.filename);
    let contents: Buffer;
    try {
      contents = fs.readFileSync(artifactPath);
    } catch (error) {
      throw new Error(
        `Cannot resume bisect: repair artifact "${repair.id}" is missing at ${artifactPath}`,
        { cause: error },
      );
    }
    if (hash(contents) !== repair.sha256) {
      throw new Error(
        `Cannot resume bisect: repair artifact "${repair.id}" changed`,
      );
    }
  }
}

export function repairArtifactPath(resultsDirectory: string, filename: string): string {
  const patchesDirectory = path.resolve(resultsDirectory, 'patches');
  const artifactPath = path.resolve(resultsDirectory, filename);
  if (path.dirname(artifactPath) !== patchesDirectory || !artifactPath.endsWith('.patch')) {
    throw new Error(`Invalid bisect repair artifact path: ${filename}`);
  }
  return artifactPath;
}

async function resolveApplicableShas(
  configured: BisectRepairConfig,
  experimentDir: string,
  range: PreparedGitRange,
): Promise<string[]> {
  if ('commits' in configured.appliesTo) {
    const resolved = await Promise.all(configured.appliesTo.commits.map((ref) => (
      resolveCommit(experimentDir, ref)
    )));
    return [...new Set(resolved)];
  }

  const fromSha = configured.appliesTo.from
    ? await resolveCommit(experimentDir, configured.appliesTo.from)
    : range.goodSha;
  const throughSha = await resolveCommit(experimentDir, configured.appliesTo.through);
  const fromIndex = range.orderedCommits.indexOf(fromSha);
  const throughIndex = range.orderedCommits.indexOf(throughSha);
  if (fromIndex < 0) {
    throw new Error(
      `Bisect repair "${configured.id}" from commit ${fromSha} is outside the primary range`,
    );
  }
  if (throughIndex < 0) {
    throw new Error(
      `Bisect repair "${configured.id}" through commit ${throughSha} is outside the primary range`,
    );
  }
  if (fromIndex > throughIndex) {
    throw new Error(
      `Bisect repair "${configured.id}" interval is reversed (${fromSha} after ${throughSha})`,
    );
  }
  return range.orderedCommits.slice(fromIndex, throughIndex + 1);
}

function validateDataRepair(repair: BisectRepairConfig, rebuildContainer: boolean): void {
  if (repair.kind === 'data' && repair.prepareCommands.length > 0
    && repair.cleanupCommands.length === 0 && !rebuildContainer) {
    throw new Error(
      `Compare-bisect data repair "${repair.id}" needs cleanupCommands when rebuildContainer is false`,
    );
  }
}

function hash(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}
