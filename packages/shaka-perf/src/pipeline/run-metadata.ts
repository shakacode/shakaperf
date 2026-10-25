/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Viewport } from '../config';
import type { LighthouseConfig } from '../bench/core/lighthouse-config';
import { readContainerCommit, SERVER_COMMIT_LABEL } from '../twin-servers/helpers/server-commit';

export type MeasurementSide = 'control' | 'experiment';
export interface MeasuredCommit {
  sha: string;
  message: string;
  source: string;
}
export interface MeasurementTarget {
  side: MeasurementSide;
  url: string;
  commit: MeasuredCommit | null;
}
export interface MeasurementThrottling {
  engine: string;
  method: string;
  cpuSlowdownMultiplier?: number;
  network: Record<string, number>;
  side?: string;
}
export interface RunMetadata {
  command: string;
  runId: string;
  measuredAt: string;
  stages: string[];
  categories: string[];
  viewport: Viewport;
  targets: MeasurementTarget[];
  throttling?: MeasurementThrottling[];
  /** Effective Lighthouse samples requested per measured side. */
  numberOfMeasurements?: number;
  /** Effective visual comparison retry budget, after runtime overrides. */
  compareRetries?: number;
  /** Actual visual comparison attempts started across worker retries. */
  compareAttempts?: number;
  /** Worker retries actually started after errors/timeouts, across this stage's tasks. */
  taskRetries?: number;
  /** Effective error retry budget for each worker task, after runtime overrides. */
  taskRetryLimit?: number;
}

/** Reconstruct the measurement invocation without changing any argument values. */
export function measurementCommand(argv: readonly string[] = process.argv.slice(2)): string {
  return ['shaka-perf', ...argv].map((part) => /^[\w./:@=-]+$/.test(part)
    ? part
    : `'${part.replace(/'/g, "'\\''")}'`).join(' ');
}

/** Input comes from Lighthouse's resolved configSettings, after all engine defaults. */
export function lighthouseThrottling(settings: Pick<LighthouseConfig, 'throttlingMethod' | 'throttling'>): MeasurementThrottling | undefined {
  const method = settings.throttlingMethod;
  if (!method) return undefined;
  const throttling = settings.throttling;
  const fields = method === 'simulate' ? ['rttMs', 'throughputKbps']
    : method === 'devtools' ? ['requestLatencyMs', 'downloadThroughputKbps', 'uploadThroughputKbps'] : [];
  return {
    engine: 'Lighthouse',
    method,
    ...(method !== 'provided' && typeof throttling?.cpuSlowdownMultiplier === 'number'
      ? { cpuSlowdownMultiplier: throttling.cpuSlowdownMultiplier } : {}),
    network: Object.fromEntries(Object.entries(throttling ?? {})
      .filter(([key, value]) => fields.includes(key) && typeof value === 'number')) as Record<string, number>,
  };
}

const execFileAsync = promisify(execFile);
/**
 * Read the exact running twin server's Git identity, captured at build/reload.
 * Neither HTTP headers nor the operator's current checkout establish identity.
 */
export async function measuredCommit(urlString: string): Promise<MeasuredCommit | null> {
  const url = new URL(urlString);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
  try {
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const options = { timeout: 2000, maxBuffer: 128 * 1024 };
    const { stdout: ids } = await execFileAsync('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.ID}}'], options);
    const containers = ids.trim().split(/\s+/).filter(Boolean);
    if (containers.length !== 1) return null;
    const container = containers[0]!;
    // A published-port filter can match a port range. Verify the exact binding
    // and service identity without reading the container's secret environment.
    const { stdout: info } = await execFileAsync('docker', ['inspect', '--format', `{{json .NetworkSettings.Ports}}\n{{index .Config.Labels "com.docker.compose.service"}}\n{{index .Config.Labels "${SERVER_COMMIT_LABEL}"}}`, container], options);
    const [portsJson, service, imageCommit] = info.trim().split('\n');
    const ports = JSON.parse(portsJson!) as Record<string, { HostPort: string; HostIp: string }[] | null>;
    const boundHosts = new Set(Object.entries(ports).flatMap(([containerPort, bindings]) =>
      containerPort.endsWith('/tcp')
        ? (bindings ?? []).filter((binding) => binding.HostPort === port).map((binding) => binding.HostIp)
        : []));
    const ipv4 = boundHosts.has('0.0.0.0') || boundHosts.has('127.0.0.1');
    const ipv6 = boundHosts.has('::') || boundHosts.has('::1');
    // localhost can resolve to either family. A partial binding does not prove
    // which application a browser reached, so fail closed rather than guessing.
    const bound = url.hostname === 'localhost' ? ipv4 && ipv6
      : url.hostname === '127.0.0.1' ? ipv4 : ipv6;
    if (!['control-server', 'experiment-server'].includes(service!) || !bound) return null;
    return await readContainerCommit(container, imageCommit);
  } catch {
    return null;
  }
}
