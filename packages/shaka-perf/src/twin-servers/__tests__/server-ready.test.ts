/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as http from 'node:http';
import { EventEmitter } from 'events';
import type { ResolvedConfig } from '../types';
import {
  initialServerStatus,
  probeHttpEndpoint,
  probeHttpPort,
  probeServerStatus,
  serverUrl,
  serversReady,
} from '../helpers/server-ready';

jest.mock('node:http', () => ({
  request: jest.fn(),
}));

function configWithPorts(control: number, experiment: number): ResolvedConfig {
  return {
    ports: { control, experiment },
    volumes: {
      control: '/tmp/shaka-perf-volumes/app/control',
      experiment: '/tmp/shaka-perf-volumes/app/experiment',
    },
  } as ResolvedConfig;
}

describe('server-ready helpers', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('derives display URLs from configured ports', () => {
    expect(serverUrl(3020)).toBe('http://localhost:3020');

    const status = initialServerStatus(configWithPorts(3020, 3030));

    expect(status.control.url).toBe('http://localhost:3020');
    expect(status.experiment.url).toBe('http://localhost:3030');
    expect(status.control.volumeDir).toBe('/tmp/shaka-perf-volumes/app/control');
    expect(status.experiment.volumeDir).toBe('/tmp/shaka-perf-volumes/app/experiment');
    expect(status.control.status).toBe('checking');
    expect(status.experiment.status).toBe('checking');
    expect(serversReady(status)).toBe(false);
  });

  it('reports ready and down endpoints from URL probes', async () => {
    const mockRequest = http.request as jest.MockedFunction<typeof http.request>;
    mockRequest.mockImplementation(((options: http.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
      const req = new EventEmitter() as http.ClientRequest;
      req.destroy = jest.fn() as typeof req.destroy;
      req.end = jest.fn() as typeof req.end;

      setImmediate(() => {
        if (options.port === 3020) {
          callback?.({
            resume: jest.fn(),
            statusCode: 200,
          } as unknown as http.IncomingMessage);
        } else {
          const error = new Error('connection refused') as NodeJS.ErrnoException;
          error.code = 'ECONNREFUSED';
          req.emit('error', error);
        }
      });

      return req;
    }) as typeof http.request);

    const status = await probeServerStatus(configWithPorts(3020, 3030), 100);

    expect(status.control.status).toBe('ready');
    expect(status.experiment.status).toBe('down');
    expect(status.experiment.detail).toBe('ECONNREFUSED');
    expect(status.checkedAt).toBeInstanceOf(Date);
    expect(serversReady(status)).toBe(false);
  });

  it('does not report ready without an HTTP response', async () => {
    const mockRequest = http.request as jest.MockedFunction<typeof http.request>;
    mockRequest.mockImplementation((() => {
      const req = new EventEmitter() as http.ClientRequest;
      req.destroy = jest.fn() as typeof req.destroy;
      req.end = jest.fn() as typeof req.end;
      setImmediate(() => req.emit('timeout'));
      return req;
    }) as typeof http.request);

    await expect(probeHttpPort(3020, 100)).resolves.toBe(false);
  });

  it('reports HTTP error status details while treating the URL as reachable', async () => {
    const mockRequest = http.request as jest.MockedFunction<typeof http.request>;
    mockRequest.mockImplementation(((options: http.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
      expect(options.host).toBe('localhost');
      expect(options.family).toBe(4);
      expect(options.headers).toEqual(expect.objectContaining({ Host: `localhost:${options.port}` }));

      const req = new EventEmitter() as http.ClientRequest;
      req.destroy = jest.fn() as typeof req.destroy;
      req.end = jest.fn() as typeof req.end;
      setImmediate(() => {
        callback?.({
          resume: jest.fn(),
          statusCode: 500,
        } as unknown as http.IncomingMessage);
      });
      return req;
    }) as typeof http.request);

    await expect(probeHttpEndpoint(3020, 100)).resolves.toEqual({
      ready: true,
      detail: 'HTTP 500',
    });
  });
});
