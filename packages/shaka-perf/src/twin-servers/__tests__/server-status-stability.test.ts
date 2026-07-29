/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ServerEndpointStatus, ServerStatusSnapshot } from '../helpers/server-ready';
import { createServerStatusStabilizer } from '../helpers/server-status-stability';

function endpoint(
  side: 'control' | 'experiment',
  status: ServerEndpointStatus['status'],
): ServerEndpointStatus {
  return {
    side,
    label: side === 'control' ? 'Control' : 'Experiment',
    port: side === 'control' ? 3020 : 3030,
    url: side === 'control' ? 'http://localhost:3020' : 'http://localhost:3030',
    volumeDir: `/tmp/${side}`,
    status,
  };
}

function snapshot(
  control: ServerEndpointStatus['status'],
  experiment: ServerEndpointStatus['status'],
): ServerStatusSnapshot {
  return {
    control: endpoint('control', control),
    experiment: endpoint('experiment', experiment),
    checkedAt: new Date(),
  };
}

describe('server status stability', () => {
  it('turns a first ready-to-down poll into checking, then down on repeat', () => {
    const stabilizer = createServerStatusStabilizer();
    const previous = snapshot('ready', 'ready');

    const first = stabilizer.stabilize(previous, snapshot('down', 'ready'));
    expect(first.control.status).toBe('checking');
    expect(first.experiment.status).toBe('ready');

    const second = stabilizer.stabilize(first, snapshot('down', 'ready'));
    expect(second.control.status).toBe('down');
    expect(second.experiment.status).toBe('ready');
  });

  it('resets the down streak after a successful response', () => {
    const stabilizer = createServerStatusStabilizer();
    const previous = snapshot('ready', 'ready');

    const first = stabilizer.stabilize(previous, snapshot('down', 'ready'));
    expect(first.control.status).toBe('checking');

    const recovered = stabilizer.stabilize(first, snapshot('ready', 'ready'));
    expect(recovered.control.status).toBe('ready');

    const nextMiss = stabilizer.stabilize(recovered, snapshot('down', 'ready'));
    expect(nextMiss.control.status).toBe('checking');
  });

  it('reset clears accumulated misses before a fresh startup', () => {
    const stabilizer = createServerStatusStabilizer();
    const previous = snapshot('ready', 'ready');

    stabilizer.stabilize(previous, snapshot('down', 'ready'));
    stabilizer.reset();

    const afterReset = stabilizer.stabilize(previous, snapshot('down', 'ready'));
    expect(afterReset.control.status).toBe('checking');
  });
});
