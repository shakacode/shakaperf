/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ServerEndpointStatus, ServerSide, ServerStatusSnapshot } from './server-ready';

type DownStreak = Record<ServerSide, number>;

/**
 * Smooth background status polling so a single slow URL probe does not make a
 * healthy server flash down. Explicit startup/restart waits bypass this helper
 * and use raw status so failures are still surfaced promptly.
 */
export function createServerStatusStabilizer(): {
  reset(): void;
  stabilize(previous: ServerStatusSnapshot, next: ServerStatusSnapshot): ServerStatusSnapshot;
} {
  const downStreak: DownStreak = { control: 0, experiment: 0 };

  const stabilizeEndpoint = (
    previous: ServerEndpointStatus,
    next: ServerEndpointStatus,
  ): ServerEndpointStatus => {
    if (next.status === 'ready') {
      downStreak[next.side] = 0;
      return next;
    }
    if (previous.status === 'ready') {
      downStreak[next.side]++;
      return { ...next, status: downStreak[next.side] >= 2 ? 'down' : 'checking' };
    }
    return next;
  };

  return {
    reset(): void {
      downStreak.control = 0;
      downStreak.experiment = 0;
    },
    stabilize(previous: ServerStatusSnapshot, next: ServerStatusSnapshot): ServerStatusSnapshot {
      return {
        ...next,
        control: stabilizeEndpoint(previous.control, next.control),
        experiment: stabilizeEndpoint(previous.experiment, next.experiment),
      };
    },
  };
}
