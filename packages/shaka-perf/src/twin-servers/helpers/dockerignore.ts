/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Shaka Perf output is host-side diagnostic data. It can be many gigabytes
 * and is never an input to the application image, so every twin-server build
 * excludes it even when the project has not added these rules itself.
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

const DEFAULTS_HEADER = '# Shaka Perf defaults (applied automatically)';
let temporaryDockerfileSequence = 0;

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

/**
 * Put Shaka Perf's defaults before project rules so an explicit negation in a
 * project's dockerignore can still opt a path back into the build context.
 */
export function effectiveDockerignore(projectDockerignore: string): string {
  const defaults = [DEFAULTS_HEADER, ...SHAKA_PERF_DOCKERIGNORE_PATTERNS].join('\n');
  const projectRules = projectDockerignore.trim();
  return projectRules ? `${defaults}\n\n${projectRules}\n` : `${defaults}\n`;
}

export interface PreparedDockerfile {
  /** Dockerfile path suitable for passing to `docker buildx build -f`. */
  dockerfilePath: string;
  cleanup: () => void;
}

/**
 * Docker has no CLI flag for adding ignore patterns. Create a short-lived
 * Dockerfile copy with its own `<Dockerfile>.dockerignore`, which Docker gives
 * precedence over the context-root ignore file. The consumer's files remain
 * untouched and the temporary pair is removed after the build.
 */
export function prepareDockerfileWithDefaults(
  buildDir: string,
  dockerfilePath: string,
): PreparedDockerfile {
  const dockerfileAbs = path.resolve(buildDir, dockerfilePath);
  const suffix = `${process.pid}-${Date.now()}-${temporaryDockerfileSequence++}`;
  const temporaryDockerfileAbs = path.join(
    path.dirname(dockerfileAbs),
    `.shaka-perf-${path.basename(dockerfileAbs)}-${suffix}`,
  );
  const temporaryDockerignoreAbs = `${temporaryDockerfileAbs}.dockerignore`;

  const cleanup = () => {
    fs.rmSync(temporaryDockerfileAbs, { force: true });
    fs.rmSync(temporaryDockerignoreAbs, { force: true });
  };

  try {
    fs.copyFileSync(dockerfileAbs, temporaryDockerfileAbs);
    fs.writeFileSync(
      temporaryDockerignoreAbs,
      effectiveDockerignore(readProjectDockerignore(buildDir, dockerfileAbs)),
      'utf8',
    );
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    dockerfilePath: path.isAbsolute(dockerfilePath)
      ? temporaryDockerfileAbs
      : path.relative(buildDir, temporaryDockerfileAbs),
    cleanup,
  };
}
