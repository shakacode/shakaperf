/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'path';
import type { ResolvedConfig } from '../types';

export type ServerSide = 'control' | 'experiment';

export function projectDirForSide(config: ResolvedConfig, side: ServerSide): string {
  return side === 'control' ? config.controlDir : config.experimentDir;
}

export function dockerBuildDirForSide(config: ResolvedConfig, side: ServerSide): string {
  const relativeBuildDir = path.relative(config.projectDir, config.dockerBuildDir);
  return path.resolve(projectDirForSide(config, side), relativeBuildDir);
}

export function dockerfilePathForSide(config: ResolvedConfig, side: ServerSide): string {
  if (path.isAbsolute(config.dockerfile)) return config.dockerfile;
  return path.join(
    path.relative(dockerBuildDirForSide(config, side), projectDirForSide(config, side)),
    config.dockerfile,
  );
}

export function dockerfileAbsForSide(config: ResolvedConfig, side: ServerSide): string {
  if (path.isAbsolute(config.dockerfile)) return config.dockerfile;
  return path.join(projectDirForSide(config, side), config.dockerfile);
}
