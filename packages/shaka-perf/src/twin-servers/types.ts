/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { z } from 'zod';

export const SetupCommandSchema = z.object({
  /** The shell command to execute in the container */
  command: z.string().min(1, 'command is required'),
  /** Human-readable description shown during execution */
  description: z.string().min(1, 'description is required'),
});

export const CopyIgnoreConfigSchema = z.object({
  /** Repository-relative directory patterns excluded from change copying. */
  folders: z.array(z.string().min(1)).optional(),
  /** Repository-relative file patterns excluded from change copying. */
  files: z.array(z.string().min(1)).optional(),
});

export const TwinServersConfigSchema = z.object({
  /**
   * Experiment checkout directory. Use `process.cwd()` when running commands
   * from inside the experiment repo; set a different path to run from elsewhere.
   */
  experimentDir: z.string().min(1, 'experimentDir is required'),
  controlDir: z.string().min(1, 'controlDir is required'),
  dockerBuildDir: z.string().min(1, 'dockerBuildDir is required'),
  dockerfile: z.string().min(1, 'dockerfile is required'),
  dockerBuildArgs: z.record(z.string(), z.string()).default({}),
  composeFile: z.string().min(1).optional(),
  procfile: z.string().min(1, 'procfile is required'),
  /**
   * Host ports the twin containers bind to. Required — there's no sensible
   * default that works when you run two twin-servers projects side-by-side,
   * so each project picks its own pair. The `init` template assigns the pair
   * once (via `assignPortsAutomatically` / `CONDUCTOR_PORT`) and reuses the
   * same constants here and in `shared.*URL`, so the two can't drift.
   */
  ports: z.object({
    control: z.number().int().positive(),
    experiment: z.number().int().positive(),
  }),
  /**
   * Commands run in both containers (in parallel) after they start. LAST
   * RESORT: prefer doing all setup — install, build, migrate, seed — in the
   * Dockerfile so the image is self-contained. Use these only for what can't be
   * baked into an image, chiefly starting an embedded service daemon. Most apps
   * need none.
   */
  setupCommands: z.array(SetupCommandSchema).optional(),
  /**
   * Commands that rebuild application state after experiment source changes.
   * They run inside the experiment container before its processes restart.
   */
  rebuildCommands: z.array(SetupCommandSchema).optional(),
  /**
   * Host-only files and folders excluded from twin-server change copying.
   * Each supplied array overrides its corresponding packaged default list.
   */
  copyIgnore: CopyIgnoreConfigSchema.optional(),
});

// Derive types from schemas
export type SetupCommand = z.infer<typeof SetupCommandSchema>;
export type CopyIgnoreConfigInput = z.input<typeof CopyIgnoreConfigSchema>;
export interface CopyIgnoreConfig {
  folders: string[];
  files: string[];
}
export type TwinServersConfig = z.infer<typeof TwinServersConfigSchema>;
export type TwinServersConfigInput = z.input<typeof TwinServersConfigSchema>;

// ResolvedConfig has setupCommands and composeFile as required (non-optional)
export type ResolvedConfig = Omit<
  TwinServersConfig,
  'setupCommands' | 'composeFile' | 'experimentDir' | 'copyIgnore'
> & {
  /** Current project directory that owns twin-server config, Procfile, and compose. */
  projectDir: string;
  /** Resolved absolute experiment directory */
  experimentDir: string;
  /** Setup commands to run (empty array if none provided) */
  setupCommands: SetupCommand[];
  /** In-container rebuild commands available to the experiment server. */
  rebuildCommands: SetupCommand[];
  /** Effective host-only paths excluded from manual, automatic, and SSH copying. */
  copyIgnore: CopyIgnoreConfig;
  /** Resolved compose file path (defaults to bundled template) */
  composeFile: string;
  /**
   * Auto-derived `repo:tag` image refs. The repo name is `projectSlug`, so
   * two local twin-server projects get distinct images without any config.
   */
  images: { control: string; experiment: string };
  /**
   * Auto-derived host bind-mount dirs, `~/shaka-perf-volumes/<projectSlug>/<side>`.
   * Namespaced by `projectSlug` so two local twin-server projects never share
   * a host dir.
   */
  volumes: { control: string; experiment: string };
  /**
   * Docker-safe slug derived from the local projectDir (its path relative to
   * home). Used to namespace image names, volume dirs, and the compose project
   * so two twin-server projects don't share Docker resources.
   */
  projectSlug: string;
};
