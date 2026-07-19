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
import * as os from 'os';
import {
  loadConfigFile,
  findConfigFile as sharedFindConfigFile,
  findAbTestsConfig,
  loadAbTestsConfig,
} from '../config-loader';
import {
  SetupCommandSchema,
  TwinServersConfigSchema,
  type ResolvedConfig,
  type SetupCommand,
  type TwinServersConfig,
  type TwinServersConfigInput,
} from './types';

const LEGACY_CONFIG_FILENAMES = ['twin-servers.config.ts', 'twin-servers.config.js'];

// At runtime __dirname is dist/twin-servers/, so go up two levels to package root
const DEFAULT_COMPOSE_FILE = path.resolve(__dirname, '..', '..', 'templates', 'docker-compose.yml');

const TwinServersRuntimeConfigSchema = TwinServersConfigSchema.extend({
  rebuildCommands: SetupCommandSchema.array().optional(),
});

type TwinServersRuntimeConfig = TwinServersConfig & {
  rebuildCommands?: SetupCommand[];
};

export function defineConfig(config: TwinServersConfigInput): TwinServersConfigInput {
  return config;
}

export function findConfigFile(cwd?: string): string | null {
  return findAbTestsConfig(cwd) ?? sharedFindConfigFile(LEGACY_CONFIG_FILENAMES, cwd);
}

export async function loadConfig(configPath: string): Promise<TwinServersRuntimeConfig> {
  const basename = path.basename(configPath);
  if (basename.startsWith('abtests.config.')) {
    const raw = await loadAbTestsConfig(configPath);
    const slice = (raw as { twinServers?: unknown }).twinServers;
    if (!slice) {
      throw new Error(
        `${configPath} has no \`twinServers\` section. Add one or use a legacy twin-servers.config.ts.`,
      );
    }
    const bisect = raw.bisect as { rebuildCommands?: SetupCommand[] } | undefined;
    return {
      ...(slice as TwinServersConfig),
      rebuildCommands: bisect?.rebuildCommands,
    };
  }
  return loadConfigFile(configPath) as Promise<TwinServersRuntimeConfig>;
}

function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Derive a docker-safe slug from an absolute path, used to namespace images,
 * host bind-mount dirs, and the compose project name. Two checkouts must never
 * share these: images/volumes are derived solely from this slug, and starting a
 * server `rmSync`s its volume dir, so a collision silently clobbers one
 * checkout's image and wipes the other's bind-mount.
 *
 * Path separators become `--`, so the directory structure survives in the slug
 * and `~/foo/my-app` (`foo--my-app`) can't collide with `~/foo-my-app`
 * (`foo-my-app`). `--` is therefore reserved as the separator token: a path that
 * already contains a literal `--` would be ambiguous, so we throw and ask the
 * user to rename the checkout rather than silently risk a collision.
 */
export function projectPathSlug(absPath: string): string {
  const home = os.homedir();
  let rel = absPath;
  if (rel === home) {
    rel = '';
  } else if (rel.startsWith(home + path.sep)) {
    rel = rel.slice(home.length + 1);
  }
  if (rel.includes('--')) {
    throw new Error(
      `Cannot derive a unique slug from "${absPath}": it contains "--", which ` +
        `twin-servers reserves as the path separator in derived image and volume ` +
        `names. Rename the checkout directory to remove "--".`,
    );
  }
  const slug = rel
    .split(path.sep)
    .join('--')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return slug || 'root';
}

export function resolveConfig(config: unknown, cwd: string = process.cwd()): ResolvedConfig {
  // Validate schema with Zod
  const parseResult = TwinServersRuntimeConfigSchema.safeParse(config);
  if (!parseResult.success) {
    const firstError = parseResult.error.errors[0];
    const fieldPath = firstError.path.join('.');
    throw new Error(fieldPath ? `${fieldPath}: ${firstError.message}` : firstError.message);
  }
  const validConfig = parseResult.data;

  // Resolve paths and validate existence.
  const projectDir = path.resolve(cwd);
  const experimentDir = path.resolve(projectDir, expandTilde(validConfig.experimentDir));
  const controlDir = path.resolve(projectDir, expandTilde(validConfig.controlDir));
  const dockerBuildDir = path.resolve(projectDir, expandTilde(validConfig.dockerBuildDir));

  if (!fs.existsSync(experimentDir)) {
    throw new Error(`Experiment directory not found: ${experimentDir}`);
  }
  // Note: controlDir is only validated when building control target (in build.ts)
  if (!fs.existsSync(dockerBuildDir)) {
    throw new Error(`Docker build root not found: ${dockerBuildDir}`);
  }

  const slug = projectPathSlug(projectDir);

  // Images and volumes are fully derived from the slug — no config needed.
  // The slug namespaces both, so two local twin-server project directories get
  // distinct images and distinct host bind dirs even when they point at the
  // same control/experiment pair.
  const volumeBase = path.join(os.homedir(), 'shaka-perf-volumes', slug);

  return {
    projectDir,
    experimentDir,
    controlDir,
    dockerBuildDir,
    dockerfile: validConfig.dockerfile,
    dockerBuildArgs: validConfig.dockerBuildArgs,
    composeFile: validConfig.composeFile
      ? path.resolve(projectDir, validConfig.composeFile)
      : DEFAULT_COMPOSE_FILE,
    procfile: path.resolve(projectDir, validConfig.procfile),
    images: {
      control: `${slug}:control`,
      experiment: `${slug}:experiment`,
    },
    volumes: {
      control: path.join(volumeBase, 'control'),
      experiment: path.join(volumeBase, 'experiment'),
    },
    ports: validConfig.ports,
    setupCommands: validConfig.setupCommands ?? [],
    rebuildCommands: validConfig.rebuildCommands ?? [],
    projectSlug: slug,
  };
}
