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
import { assignPortsAutomatically, type AssignPortsDeps } from '../assign-ports';

describe('assignPortsAutomatically', () => {
  let dir: string;
  let settingsPath: string;

  // The mandatory preferred pair used across most cases (a 10-port gap, like
  // the documented example).
  const pref = { control: 3040, experiment: 3050 };

  // Isolated deps: a temp settings file and every port reads free.
  const baseDeps = (): AssignPortsDeps => ({ settingsPath, isPortInUse: () => false, env: {} });

  const settings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-ports-'));
    settingsPath = path.join(dir, 'ports.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the preferred pair verbatim when free, and records it', () => {
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, baseDeps())).toEqual({ control: 3040, experiment: 3050 });
    expect(settings().assignments.a).toEqual({ control: 3040, experiment: 3050 });
  });

  it('shifts the pair up together (preserving the gap) when the control port is in use', () => {
    const deps = { ...baseDeps(), isPortInUse: (p: number) => p === 3040 };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 3041, experiment: 3051 });
  });

  it('shifts the pair up together when the experiment port is in use', () => {
    const deps = { ...baseDeps(), isPortInUse: (p: number) => p === 3050 };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 3041, experiment: 3051 });
  });

  it('keeps shifting past several consecutive busy ports', () => {
    const busy = new Set([3040, 3041, 3042]);
    const deps = { ...baseDeps(), isPortInUse: (p: number) => busy.has(p) };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 3043, experiment: 3053 });
  });

  it('shifts past a pair already owned by another project', () => {
    assignPortsAutomatically({ ...pref, key: 'a' }, baseDeps()); // a -> 3040/3050
    expect(assignPortsAutomatically({ ...pref, key: 'b' }, baseDeps())).toEqual({ control: 3041, experiment: 3051 });
  });

  it('reuses the remembered pair on repeat calls without re-probing', () => {
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, baseDeps())).toEqual({ control: 3040, experiment: 3050 });
    // Even with every port now reading as busy, the sticky pair is reused.
    const allBusy = { ...baseDeps(), isPortInUse: () => true };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, allBusy)).toEqual({ control: 3040, experiment: 3050 });
  });

  it('returns env-override ports verbatim and does not persist them', () => {
    const deps: AssignPortsDeps = {
      ...baseDeps(),
      env: { SHAKAPERF_CONTROL_PORT: '4000', SHAKAPERF_EXPERIMENT_PORT: '4001' },
    };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 4000, experiment: 4001 });
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it('derives the pair from SHAKAPERF_BASE_PORT and does not persist it', () => {
    const deps: AssignPortsDeps = { ...baseDeps(), env: { SHAKAPERF_BASE_PORT: '4200' } };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 4200, experiment: 4201 });
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it('derives the pair from CONDUCTOR_PORT when SHAKAPERF_BASE_PORT is unset, and does not persist it', () => {
    const deps: AssignPortsDeps = { ...baseDeps(), env: { CONDUCTOR_PORT: '5000' } };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 5000, experiment: 5001 });
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it('prefers SHAKAPERF_BASE_PORT over CONDUCTOR_PORT', () => {
    const deps: AssignPortsDeps = {
      ...baseDeps(),
      env: { SHAKAPERF_BASE_PORT: '4200', CONDUCTOR_PORT: '5000' },
    };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 4200, experiment: 4201 });
  });

  it('lets the explicit pair override win over a base port', () => {
    const deps: AssignPortsDeps = {
      ...baseDeps(),
      env: { SHAKAPERF_CONTROL_PORT: '4000', SHAKAPERF_EXPERIMENT_PORT: '4001', CONDUCTOR_PORT: '5000' },
    };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 4000, experiment: 4001 });
  });

  it('ignores an invalid base port and falls through to the scan path', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const deps: AssignPortsDeps = { ...baseDeps(), env: { SHAKAPERF_BASE_PORT: 'nope' } };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 3040, experiment: 3050 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid integer'));
    warn.mockRestore();
  });

  it('ignores an out-of-range base port (no room for the experiment offset), warns, and falls through', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // 65535 leaves no room for the +1 experiment offset, so it is rejected.
    const deps: AssignPortsDeps = { ...baseDeps(), env: { SHAKAPERF_BASE_PORT: '65535' } };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 3040, experiment: 3050 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('out of range'));
    warn.mockRestore();
  });

  it('warns about a privileged base port but still derives (and does not persist) the pair', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const deps: AssignPortsDeps = { ...baseDeps(), env: { SHAKAPERF_BASE_PORT: '1000' } };
    expect(assignPortsAutomatically({ ...pref, key: 'a' }, deps)).toEqual({ control: 1000, experiment: 1001 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('privileged'));
    expect(fs.existsSync(settingsPath)).toBe(false);
    warn.mockRestore();
  });

  it('throws when a preferred port is missing, non-positive, or the two are equal', () => {
    // Both ports are mandatory — a caller that omits one (or passes a bad/equal
    // value) fails fast instead of silently defaulting.
    expect(() => assignPortsAutomatically({ control: 3040 } as never, baseDeps())).toThrow(/required/);
    expect(() => assignPortsAutomatically({ experiment: 3050 } as never, baseDeps())).toThrow(/required/);
    expect(() => assignPortsAutomatically({ control: 0, experiment: 3050, key: 'a' }, baseDeps())).toThrow(/required/);
    expect(() => assignPortsAutomatically({ control: 3040, experiment: 3040, key: 'a' }, baseDeps())).toThrow(/must differ/);
  });
});
