/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';

/**
 * Shaka Perf output is host-side diagnostic data. It can be many gigabytes
 * and is never an input to the application image. Projects own their Docker
 * ignore rules; Shaka Perf uses these patterns for setup guidance and warnings.
 *
 * Keep the root and globstar forms: a build context may be the project itself
 * or the root of a monorepo containing the project.
 */
export const SHAKA_PERF_DOCKERIGNORE_PATTERNS = [
  'compare-bisect-results*/',
  '**/compare-bisect-results*/',
  'compare-results*/',
  '**/compare-results*/',
];

export function readProjectDockerignore(
  buildDir: string,
  dockerfileAbs: string,
): string {
  const candidates = [
    `${dockerfileAbs}.dockerignore`,
    path.join(buildDir, '.dockerignore'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
  }
  return '';
}

export function findUnignoredShakaResultDirs(
  buildDir: string,
  dockerfileAbs: string,
  projectDir: string,
): string[] {
  const matcher = ignore();
  const dockerignore = readProjectDockerignore(buildDir, dockerfileAbs);
  if (dockerignore) matcher.add(dockerignore);

  const relativeProjectDir = path.relative(buildDir, projectDir);
  const outsideBuildContext = relativeProjectDir === '..'
    || relativeProjectDir.startsWith(`..${path.sep}`);
  const prefix = relativeProjectDir && !outsideBuildContext
    ? `${relativeProjectDir.split(path.sep).join('/')}/`
    : '';
  const resultDirs = ['compare-bisect-results/', 'compare-results/'];

  return resultDirs.filter((dir) => !matcher.ignores(`${prefix}${dir}`));
}

export function warnIfShakaResultsNotIgnored(
  side: 'control' | 'experiment',
  buildDir: string,
  dockerfileAbs: string,
  projectDir: string,
): void {
  const missing = findUnignoredShakaResultDirs(
    buildDir,
    dockerfileAbs,
    projectDir,
  );
  if (missing.length === 0) return;

  console.warn(
    `[twin-servers] Warning: ${side} Docker ignore rules do not exclude ` +
      `${missing.join(', ')}. Shaka Perf result folders can add many gigabytes to the image.`,
  );
  console.warn(
    `[twin-servers] Add these rules to ${path.basename(dockerfileAbs)}.dockerignore:\n` +
      SHAKA_PERF_DOCKERIGNORE_PATTERNS.join('\n'),
  );
}
