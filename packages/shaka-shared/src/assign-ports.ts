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
}

const MAX_PORT = 65535;

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
