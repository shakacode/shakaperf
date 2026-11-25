/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { AbTestDefinition } from 'shaka-shared';
import { shakaPerfVersion } from './saved-result-version';
import { parseOutcome, type Outcome } from './outcome';
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
  constructor(readonly resultsRoot: string) {}

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

  /** One immutable snapshot shared by every measuring stage at this viewport. */
  writeTestSource(test: AbTestDefinition, viewportLabel: string, source: string): ArtifactPath {
    const hash = createHash('sha256').update(source).digest('hex');
    const name = `test-source-${hash}.ts`;
    const scope = this.scopeFor(test, viewportLabel);
    fs.mkdirSync(scope.dir, { recursive: true });
    const file = path.join(scope.dir, name);
    try {
      fs.writeFileSync(file, source, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return scope.pathFor(name);
  }

  writeOutcome(test: AbTestDefinition, viewportLabel: string, outcome: Outcome): void {
    const dir = this.unitDirForViewport(test, viewportLabel);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${outcome.stage}.json`),
      JSON.stringify({ ...outcome, shakaPerfVersion }, null, 2),
    );
  }

  deleteOutcome(test: AbTestDefinition, viewportLabel: string, stage: StageName): void {
    fs.rmSync(
      path.join(this.unitDirForViewport(test, viewportLabel), `${stage}.json`),
      { force: true },
    );
  }

  clearArtifacts(test: AbTestDefinition, label: string, paths: readonly string[]): void {
    const dir = this.artifactsDirForViewport(test, label);
    for (const name of new Set(paths)) {
      if (path.isAbsolute(name) || name.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) {
        throw new Error(`Invalid relative artifact path: ${name}`);
      }
      let parent = dir;
      for (const segment of name.split(path.sep).slice(0, -1)) {
        parent = path.join(parent, segment);
        if (fs.lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) {
          throw new Error(`Artifact path traverses a symbolic link: ${name}`);
        }
      }
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  }

  readOutcome(test: AbTestDefinition, viewportLabel: string, stage: StageName): Outcome | null {
    const p = path.join(this.unitDirForViewport(test, viewportLabel), `${stage}.json`);
    try {
      return parseOutcome(fs.readFileSync(p, 'utf8'));
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
        const outcome = parseOutcome(fs.readFileSync(path.join(dir, entry), 'utf8'));
        if (outcome) outcomes.push(outcome);
      } catch {
        // Report-only can still use any other readable outcomes.
      }
    }
    return outcomes;
  }

  readJsonArtifact<T>(artifactPath: string): T | undefined {
    const text = this.readTextArtifact(artifactPath);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  readTextArtifact(artifactPath: string): string | undefined {
    const absolutePath = path.resolve(this.resultsRoot, artifactPath);
    const relativePath = path.relative(this.resultsRoot, absolutePath);
    if (
      relativePath === '' ||
      path.isAbsolute(relativePath) ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`)
    ) {
      return undefined;
    }
    try {
      return fs.readFileSync(absolutePath, 'utf8');
    } catch {
      return undefined;
    }
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
