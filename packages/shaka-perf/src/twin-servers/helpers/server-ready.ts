/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as http from 'node:http';
import type { ResolvedConfig } from '../types';

export type ServerSide = 'control' | 'experiment';
export type ServerReadiness = 'checking' | 'ready' | 'down';

export interface ServerEndpointStatus {
  side: ServerSide;
  label: 'Control' | 'Experiment';
  port: number;
  url: string;
  volumeDir: string;
  status: ServerReadiness;
  detail?: string;
}

export interface ServerStatusSnapshot {
  control: ServerEndpointStatus;
  experiment: ServerEndpointStatus;
  checkedAt: Date | null;
}

/**
 * Return true iff the local HTTP endpoint behind the displayed server URL
 * returns any response within `timeoutMs`. Any status code counts: a 404/500
 * is still an accessible server, while connection resets, refusals, and
 * timeouts are not.
 */
export interface HttpProbeResult {
  ready: boolean;
  detail?: string;
}

export function probeHttpEndpoint(port: number, timeoutMs = 3000): Promise<HttpProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let req: http.ClientRequest;
    const finish = (result: HttpProbeResult): void => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve(result);
    };

    req = http.request({
      family: 4,
      headers: {
        Connection: 'close',
        Host: `localhost:${port}`,
        'User-Agent': 'shaka-perf-readiness',
      },
      host: 'localhost',
      port,
      path: '/',
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      const statusCode = res.statusCode ?? 0;
      finish({
        ready: true,
        detail: statusCode >= 400 ? `HTTP ${statusCode}` : undefined,
      });
    });
    req.once('error', (err: NodeJS.ErrnoException) => {
      finish({ ready: false, detail: err.code ?? err.message });
    });
    req.once('timeout', () => finish({ ready: false, detail: `timeout after ${timeoutMs}ms` }));
    req.end();
  });
}

export async function probeHttpPort(port: number, timeoutMs = 3000): Promise<boolean> {
  return (await probeHttpEndpoint(port, timeoutMs)).ready;
}

export function serverUrl(port: number): string {
  return `http://localhost:${port}`;
}

export function initialServerStatus(config: ResolvedConfig): ServerStatusSnapshot {
  return {
    control: makeEndpoint(config, 'control', 'checking'),
    experiment: makeEndpoint(config, 'experiment', 'checking'),
    checkedAt: null,
  };
}

export async function probeServerStatus(
  config: ResolvedConfig,
  timeoutMs = 3000,
): Promise<ServerStatusSnapshot> {
  const [controlProbe, experimentProbe] = await Promise.all([
    probeHttpEndpoint(config.ports.control, timeoutMs),
    probeHttpEndpoint(config.ports.experiment, timeoutMs),
  ]);

  return {
    control: makeEndpoint(
      config,
      'control',
      controlProbe.ready ? 'ready' : 'down',
      controlProbe.detail,
    ),
    experiment: makeEndpoint(
      config,
      'experiment',
      experimentProbe.ready ? 'ready' : 'down',
      experimentProbe.detail,
    ),
    checkedAt: new Date(),
  };
}

export function serversReady(status: ServerStatusSnapshot): boolean {
  return status.control.status === 'ready' && status.experiment.status === 'ready';
}

function makeEndpoint(
  config: ResolvedConfig,
  side: ServerSide,
  status: ServerReadiness,
  detail?: string,
): ServerEndpointStatus {
  return {
    side,
    label: side === 'control' ? 'Control' : 'Experiment',
    port: config.ports[side],
    url: serverUrl(config.ports[side]),
    volumeDir: config.volumes[side],
    status,
    detail,
  };
}
