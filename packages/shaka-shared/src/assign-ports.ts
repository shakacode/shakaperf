/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { withFileLock } from './helpers/file-lock';

// Auto-assigns a control/experiment host-port pair for twin-servers. Called
// from a project's `abtests.config.ts` so the same pair drives both the
// `shared.*URL`s (what visreg/perf hit) and `twinServers.ports` (docker's
// host-port mapping) — they can't drift because there's one source.
//
// The pair is remembered per project in a small JSON file so it stays stable
// across runs: every shaka-perf command re-evaluates the config, and without
// stickiness a later command would see the project's own running servers as
// "busy" and shift to the wrong ports. The read-modify-write of that shared
// file is wrapped in a file lock so two concurrent invocations (different
// projects, parallel agents) can't both pick the same "free" pair and clobber
// each other's entry.

export interface AssignedPorts {
  control: number;
  experiment: number;
}

export interface AssignPortsOptions {
  /**
   * Preferred host port for the control server — **required**. Taken as-is when
   * the pair is free; otherwise the pair is shifted up together (preserving the
   * control↔experiment gap) until both ports are free. Ignored once the project
   * has a remembered assignment.
   */
  control: number;
  /**
   * Preferred host port for the experiment server — **required**. Must differ
   * from `control`.
   */
  experiment: number;
  /**
   * Stable per-project key the assignment is remembered under. Defaults to
   * `process.cwd()` — the directory the config loads from.
   */
  key?: string;
}

/** Internal seams for tests so they never touch the real file or shell out. */
export interface AssignPortsDeps {
  settingsPath?: string;
  isPortInUse?: (port: number) => boolean;
  env?: NodeJS.ProcessEnv;
}

const MAX_PORT = 65535;

// Env vars checked (in order) for a base port — the start of a consecutive port
// block allocated per workspace by a concurrent-agent tool. The control and
// experiment host ports are derived from it deterministically (no probing, no
// persistence): the workspace owns the whole block, so two agents in two
// workspaces get non-overlapping pairs without coordinating through the shared
// ports.json. `SHAKAPERF_BASE_PORT` is the canonical override any tool can set;
// `CONDUCTOR_PORT` is injected automatically per workspace by Conductor.build
// (https://conductor.build) — an unofficial contract, so set SHAKAPERF_BASE_PORT
// to override if a future Conductor release changes its meaning. This mirrors
// react_on_rails' REACT_ON_RAILS_BASE_PORT/CONDUCTOR_PORT port selection.
//
// CONTRACT: we consume a two-port block — control = base, experiment = base + 1.
// The allocator must space the bases it hands out by at least 2, or adjacent
// workspaces overlap: bases 5000 and 5001 give {5000,5001} and {5001,5002},
// which collide on 5001. Conductor allocates a wide block per workspace, so this
// holds in practice. This path is deliberately probe-free and non-persisted, so
// it can't detect a violation — pin SHAKAPERF_BASE_PORT if your tool packs base
// ports more tightly than that.
const BASE_PORT_ENV_VARS = ['SHAKAPERF_BASE_PORT', 'CONDUCTOR_PORT'] as const;
const BASE_PORT_EXPERIMENT_OFFSET = 1;
// Ports 1..1023 require root to bind on Linux/macOS.
const PRIVILEGED_PORT_MAX = 1023;

interface PortSettings {
  assignments: Record<string, AssignedPorts>;
}

function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.shaka-perf', 'ports.json');
}

function readSettings(settingsPath: string): PortSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Partial<PortSettings>;
    if (parsed && typeof parsed.assignments === 'object' && parsed.assignments) {
      return { assignments: parsed.assignments as Record<string, AssignedPorts> };
    }
  } catch {
    // Missing or corrupt — start from a clean slate.
  }
  return { assignments: {} };
}

function writeSettings(settingsPath: string, settings: PortSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/**
 * Best-effort "is something on this port" check via `lsof`, mirroring
 * twin-servers' `forward-ports` checkPort. A zero exit means lsof found a
 * socket; any throw (no match, or lsof missing) is treated as "not in use" — a
 * genuine clash still fails loudly when docker tries to bind.
 */
function lsofPortInUse(port: number): boolean {
  try {
    execSync(`lsof -i :${port}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function readEnvOverride(env: NodeJS.ProcessEnv): AssignedPorts | null {
  const control = Number(env.SHAKAPERF_CONTROL_PORT);
  const experiment = Number(env.SHAKAPERF_EXPERIMENT_PORT);
  if (Number.isInteger(control) && control > 0 && Number.isInteger(experiment) && experiment > 0) {
    return { control, experiment };
  }
  return null;
}

/**
 * Derive the control/experiment pair from a base-port block env var (see
 * `BASE_PORT_ENV_VARS`). Returns null when no base var is set so the caller
 * falls through to the sticky/scan path. An invalid value (non-integer or out of
 * range) warns and is skipped — the next var in the chain still gets a chance,
 * mirroring how an explicit-pair override would simply not match.
 */
function readBasePortOverride(env: NodeJS.ProcessEnv): AssignedPorts | null {
  // Largest derived offset must stay within the valid TCP range.
  const maxBase = MAX_PORT - BASE_PORT_EXPERIMENT_OFFSET;
  for (const varName of BASE_PORT_ENV_VARS) {
    const raw = env[varName];
    if (raw == null) continue;
    const stripped = raw.trim();
    if (stripped === '') continue;
    if (!/^\d+$/.test(stripped)) {
      console.warn(`assignPortsAutomatically: ${varName}="${raw}" is not a valid integer; ignoring.`);
      continue;
    }
    const base = Number(stripped);
    if (base < 1 || base > maxBase) {
      console.warn(
        `assignPortsAutomatically: ${varName}="${raw}" is out of range (1..${maxBase}, ` +
          `leaving room for the +${BASE_PORT_EXPERIMENT_OFFSET} experiment offset); ignoring.`,
      );
      continue;
    }
    if (base <= PRIVILEGED_PORT_MAX) {
      console.warn(
        `assignPortsAutomatically: ${varName}="${raw}" is in the privileged range ` +
          `(1..${PRIVILEGED_PORT_MAX}); binding will fail without root.`,
      );
    }
    return {
      control: base,
      experiment: base + BASE_PORT_EXPERIMENT_OFFSET,
    };
  }
  return null;
}

export function assignPortsAutomatically(
  options: AssignPortsOptions,
  deps: AssignPortsDeps = {},
): AssignedPorts {
  // Both preferred ports are mandatory: every config declares the exact pair it
  // wants. Fail fast rather than silently defaulting.
  const isPositiveInt = (n: unknown): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n > 0;
  const { control: preferredControl, experiment: preferredExperiment } = options ?? {};
  if (!isPositiveInt(preferredControl) || !isPositiveInt(preferredExperiment)) {
    throw new Error(
      'assignPortsAutomatically: both control and experiment preferred ports are required and must be positive integers',
    );
  }
  if (preferredControl === preferredExperiment) {
    throw new Error('assignPortsAutomatically: control and experiment preferred ports must differ');
  }

  const env = deps.env ?? process.env;

  // Explicit env override wins and is never persisted — lets CI or a user pin
  // exact ports without disturbing the remembered assignments.
  const override = readEnvOverride(env);
  if (override) return override;

  // Base-port block (CONDUCTOR_PORT etc.): each concurrent workspace owns a
  // distinct block, so derive the pair deterministically and skip the
  // sticky/scan path entirely. Not persisted — the block, not ports.json, is the
  // source of truth, and a stale entry under this cwd would otherwise shadow a
  // re-allocated block on the next run.
  const fromBasePort = readBasePortOverride(env);
  if (fromBasePort) return fromBasePort;

  const settingsPath = deps.settingsPath ?? defaultSettingsPath();
  const isPortInUse = deps.isPortInUse ?? lsofPortInUse;
  const key = options.key ?? process.cwd();

  // Lock the shared settings file for the whole read→assign→write so a
  // concurrent caller sees our entry and shifts past it instead of racing onto
  // the same pair. The lock sits beside the file; its dir must exist first.
  const lockPath = `${settingsPath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  return withFileLock(lockPath, () => {
    const settings = readSettings(settingsPath);

    // Sticky: reuse the remembered pair without re-probing. Those ports reading
    // busy is almost certainly this project's own running servers; bumping would
    // strand a live setup.
    const existing = settings.assignments[key];
    if (existing) return existing;

    // Fresh assignment: avoid ports another project already owns plus anything
    // in use now, shifting the pair up together (preserving the gap) until both
    // free.
    const takenByOthers = new Set<number>();
    for (const [otherKey, pair] of Object.entries(settings.assignments)) {
      if (otherKey === key) continue;
      takenByOthers.add(pair.control);
      takenByOthers.add(pair.experiment);
    }
    const blocked = (port: number): boolean => takenByOthers.has(port) || isPortInUse(port);

    const ceiling = Math.max(preferredControl, preferredExperiment);
    for (let offset = 0; ceiling + offset <= MAX_PORT; offset++) {
      const control = preferredControl + offset;
      const experiment = preferredExperiment + offset;
      if (blocked(control) || blocked(experiment)) continue;

      const assigned: AssignedPorts = { control, experiment };
      settings.assignments[key] = assigned;
      writeSettings(settingsPath, settings);
      return assigned;
    }

    throw new Error(
      `assignPortsAutomatically: no free pair found shifting {control:${preferredControl}, experiment:${preferredExperiment}} up to port ${MAX_PORT}`,
    );
  }, {
    // If the lock can't be taken (a wedged .lock we can't unlink), the
    // read-modify-write runs unlocked — warn rather than silently dropping the
    // guard, since a concurrent caller could then race onto the same pair.
    onLockTimeout: () =>
      console.warn(
        `assignPortsAutomatically: could not lock ${lockPath} — assigning ports without cross-process serialization`,
      ),
  });
}
