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

export class ArtifactScope {
  constructor(readonly dir: string) {}

  async writeFile(name: string, bytes: string | Buffer): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    await fs.promises.writeFile(this.resolveSafeName(name), bytes);
  }

  async writeJson(name: string, data: unknown): Promise<void> {
    await this.writeFile(name, JSON.stringify(data, null, 2));
  }

  relativeHref(name: string): string {
    return `./artifacts/${name}`;
  }

  inlineDataUri(name: string, mimeType = mimeTypeFor(name)): string {
    const filePath = this.resolveSafeName(name);
    const bytes = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  }

  private resolveSafeName(name: string): string {
    if (path.isAbsolute(name) || name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error(`artifact name must be a local filename: ${name}`);
    }
    return path.join(this.dir, name);
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
    return new ArtifactScope(this.artifactsDirForViewport(test, viewportLabel));
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

function mimeTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.html') return 'text/html;charset=utf-8';
  if (ext === '.json') return 'application/json';
  if (ext === '.txt') return 'text/plain;charset=utf-8';
  return 'application/octet-stream';
}
