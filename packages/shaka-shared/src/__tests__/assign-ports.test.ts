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
  const baseDeps = (): AssignPortsDeps => ({ settingsPath, isPortInUse: () => false });

  const settings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-ports-'));
    settingsPath = path.join(dir, 'ports.json');
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it('throws when a preferred port is missing, non-positive, or the two are equal', () => {
    // Both ports are mandatory — a caller that omits one (or passes a bad/equal
    // value) fails fast instead of silently defaulting.
    expect(() => assignPortsAutomatically({ control: 3040 } as never, baseDeps())).toThrow(/required/);
    expect(() => assignPortsAutomatically({ experiment: 3050 } as never, baseDeps())).toThrow(/required/);
    expect(() => assignPortsAutomatically({ control: 0, experiment: 3050, key: 'a' }, baseDeps())).toThrow(/required/);
    expect(() => assignPortsAutomatically({ control: 3040, experiment: 3040, key: 'a' }, baseDeps())).toThrow(/must differ/);
  });
});
