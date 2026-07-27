/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AbTestDefinition } from 'shaka-shared';
import type { Outcome } from './outcome';
import type { StageName } from '../stage/stage';
import { testIdForTest, unitIdForTest } from './unit-id';
import { toPosixRelative } from './path-utils';

declare const artifactPathBrand: unique symbol;
export type ArtifactPath = string & { readonly [artifactPathBrand]: true };

export class ArtifactScope {
  constructor(readonly dir: string, private readonly reportRoot: string) {}

  async writeFile(name: string, bytes: string | Buffer): Promise<ArtifactPath> {
    fs.mkdirSync(this.dir, { recursive: true });
    await fs.promises.writeFile(this.resolveSafeName(name), bytes);
    return this.pathFor(name);
  }

  async writeJson(name: string, data: unknown): Promise<ArtifactPath> {
    return this.writeFile(name, JSON.stringify(data, null, 2));
  }

  pathFor(name: string): ArtifactPath {
    return toPosixRelative(
      this.reportRoot,
      this.resolveScopedPath(name),
    ) as ArtifactPath;
  }

  private resolveSafeName(name: string): string {
    if (path.isAbsolute(name) || name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error(`artifact name must be a local filename: ${name}`);
    }
    return path.join(this.dir, name);
  }

  private resolveScopedPath(name: string): string {
    const filePath = path.resolve(this.dir, name);
    const relativePath = path.relative(this.dir, filePath);
    if (
      relativePath === '' ||
      path.isAbsolute(relativePath) ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`)
    ) {
      throw new Error(`artifact path must stay inside its scope: ${name}`);
    }
    return filePath;
  }
}

export class ArtifactStore {
  constructor(readonly resultsRoot: string, private readonly runId?: string) {}

  unitDir(test: AbTestDefinition): string {
    return path.join(this.resultsRoot, testIdForTest(test));
  }

  unitDirForViewport(test: AbTestDefinition, viewportLabel: string): string {
    return path.join(this.resultsRoot, unitIdForTest(test, viewportLabel));
  }

  artifactsDirForViewport(test: AbTestDefinition, viewportLabel: string): string {
    return path.join(this.unitDirForViewport(test, viewportLabel), 'artifacts');
  }

  scopeFor(test: AbTestDefinition, viewportLabel: string): ArtifactScope {
    return new ArtifactScope(
      this.artifactsDirForViewport(test, viewportLabel),
      this.resultsRoot,
    );
  }

  writeOutcome(test: AbTestDefinition, viewportLabel: string, outcome: Outcome): void {
    const dir = this.unitDirForViewport(test, viewportLabel);
    fs.mkdirSync(dir, { recursive: true });
    const payload = this.runId && outcome.runId == null
      ? { ...outcome, runId: this.runId }
      : outcome;
    fs.writeFileSync(
      path.join(dir, `${outcome.stage}.json`),
      JSON.stringify(payload, null, 2),
    );
  }

  deleteOutcome(test: AbTestDefinition, viewportLabel: string, stage: StageName): void {
    fs.rmSync(
      path.join(this.unitDirForViewport(test, viewportLabel), `${stage}.json`),
      { force: true },
    );
  }

  /**
   * Remove the unit dir when no `<stage>.json` outcome remains at its top
   * level. The pre-run sweep deletes selected stages' outcomes individually
   * (leaving other categories' results in place) and then uses this to drop
   * dirs with nothing left to report — a leftover `artifacts/` subtree alone
   * is referenced by no outcome.
   */
  removeUnitDirWithoutOutcomes(test: AbTestDefinition, viewportLabel: string): void {
    const dir = this.unitDirForViewport(test, viewportLabel);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return; // dir doesn't exist
    }
    if (entries.some((entry) => entry.endsWith('.json'))) return;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  readOutcome(test: AbTestDefinition, viewportLabel: string, stage: StageName): Outcome | null {
    const p = path.join(this.unitDirForViewport(test, viewportLabel), `${stage}.json`);
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as Outcome;
    } catch {
      return null;
    }
  }

  readOutcomesForViewport(test: AbTestDefinition, viewportLabel: string): Outcome[] {
    const dir = this.unitDirForViewport(test, viewportLabel);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const outcomes: Outcome[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        outcomes.push(JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')) as Outcome);
      } catch {
        // Report-only can still use any other readable outcomes.
      }
    }
    return outcomes;
  }
}

export function mimeTypeForArtifactPath(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.ogv' || ext === '.ogg') return 'video/ogg';
  if (ext === '.html') return 'text/html;charset=utf-8';
  if (ext === '.json') return 'application/json';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.csv') return 'text/csv;charset=utf-8';
  if (ext === '.txt') return 'text/plain;charset=utf-8';
  return 'application/octet-stream';
}
