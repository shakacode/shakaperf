/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { minimatch } from 'minimatch';
import type { CodeCoverageConfigInput } from 'shaka-shared';
import { ABTESTS_CONFIG_PATH_ENV } from '../../../effective-config';

export type CoverageScope = ReturnType<typeof coverageScope>;
export const DEFAULT_EXCLUDES = ['**/node_modules/**', '**/.git/**', '**/.yarn/**', '**/audit-results/**', '**/*.d.ts', '**/*.abtest.*'];
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const sourceHash = (filename: string) => digest(fs.readFileSync(filename, 'utf8'));

export function coverageScope(input: CodeCoverageConfigInput = {}, configPath = process.env[ABTESTS_CONFIG_PATH_ENV]) {
  const root = path.resolve(configPath ? path.dirname(configPath) : process.cwd(), input.projectRoot ?? '.');
  const exclude = [...DEFAULT_EXCLUDES, ...(input.exclude ?? [])];
  const relative = (filename: string) => path.relative(root, filename).split(path.sep).join('/');
  const resolve = (filename: string): string => {
    let name = filename.startsWith('file:') ? fileURLToPath(filename) : filename;
    for (const [prefix, target] of Object.entries(input.pathMappings ?? {}).sort((a, b) => b[0].length - a[0].length)) {
      if (name === prefix || name.startsWith(prefix.replace(/\/$/, '') + '/')) {
        name = path.join(root, target, name.slice(prefix.length).replace(/^\//, ''));
        break;
      }
    }
    return path.resolve(root, name);
  };
  const excludes = (filename: string) => exclude.some((pattern) => minimatch(relative(filename), pattern, { dot: true }));
  const includes = (filename: string) => {
    const rel = relative(filename);
    return rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel)
      && !excludes(filename)
      && (!input.include || input.include.some((pattern) => minimatch(rel, pattern, { dot: true })));
  };
  const files = (): string[] => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const filename = path.join(dir, entry.name);
        if (exclude.some((pattern) => minimatch(relative(filename), pattern, { dot: true })
          || minimatch(relative(filename) + '/', pattern, { dot: true }))) continue;
        if (entry.isDirectory()) {
          walk(filename);
        } else if (includes(filename)) found.push(filename);
      }
    };
    if (input.include) walk(root);
    return found.sort();
  };
  const identity = digest(JSON.stringify({ projectRoot: root, include: input.include, exclude, mappings: input.pathMappings,
    instrument: input.instrument?.toString() }));
  return { root, include: input.include, exclude, resolve, relative, includes, excludes, files, identity, instrument: input.instrument };
}

export interface CoverageProvenance {
  version: 1;
  scope: string;
  sources: Record<string, string>;
  missing: string[];
  coverageHash: string;
  testHash?: string;
}

/** Bind raw artifacts to local source bytes; older data must be remeasured. */
export function coverageProvenance(raw: Record<string, unknown>, scope: CoverageScope, testFile?: string): CoverageProvenance {
  const sources: Record<string, string> = {};
  const missing: string[] = [];
  const names = new Set(scope.files());
  for (const [key, value] of Object.entries(raw)) {
    const data = value as { path?: string; inputSourceMap?: { sources?: string[]; sourceRoot?: string } };
    const filename = scope.resolve(data.path ?? key);
    if (!data.inputSourceMap && scope.includes(filename)) names.add(filename);
    for (const source of data.inputSourceMap?.sources ?? []) {
      const original = originalSource(scope, filename, data.inputSourceMap?.sourceRoot, source);
      if (scope.includes(original)) names.add(original);
    }
  }
  for (const filename of names) {
    try { sources[scope.relative(filename)] = sourceHash(filename); }
    catch { missing.push(scope.relative(filename)); }
  }
  return { version: 1, scope: scope.identity, sources, missing,
    coverageHash: digest(JSON.stringify(raw)),
    ...(testFile && fs.existsSync(testFile) ? { testHash: sourceHash(testFile) } : {}) };
}

export function originalSource(scope: CoverageScope, filename: string, sourceRoot: string | undefined, source: string): string {
  const name = sourceRoot ? sourceRoot.replace(/\/$/, '') + '/' + source : source;
  return scope.resolve(path.isAbsolute(name) || name.includes('://') ? name : path.resolve(path.dirname(filename), name));
}
