/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import type { Group } from '../pipeline/log-prefix-format';

/**
 * One attachable browser. visreg is a SINGLE browser holding both sides as
 * contexts, so one endpoint reaches both pages; perf forks a Chrome per side.
 */
export type CdpSlot = 'visreg' | 'perf:control' | 'perf:experiment';

export type CdpPorts = Readonly<Partial<Record<CdpSlot, number>>>;

export function perfCdpSlot(group: Group): CdpSlot {
  return group === 'control' ? 'perf:control' : 'perf:experiment';
}

/** Chrome's own default, so the common case is a URL the reader recognises. */
export const DEFAULT_CDP_BASE_PORT = 9222;

/** Loopback, never `0.0.0.0`: a debug port is an unauthenticated remote-control API. */
export function cdpEndpoint(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** The visreg (Playwright) side takes a flag; chrome-launcher takes the number. */
export function remoteDebuggingPortFlag(port: number): string {
  return `--remote-debugging-port=${port}`;
}

/**
 * Rides `args` because the visreg engine spreads `playwrightOptions` into
 * `launch()`. Additive, not a swap — Playwright keeps its own
 * `--remote-debugging-pipe`, so an attached agent can't disturb it.
 */
export function withCdpPort<T extends { args?: string[] }>(
  options: T,
  port: number | undefined,
): T {
  if (port == null) return options;
  return { ...options, args: [...(options.args ?? []), remoteDebuggingPortFlag(port)] };
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * First free port at or above `basePort` per slot. Probe-then-release, so it is
 * advisory — which is why endpoints are read from the manifest, not assumed.
 */
export async function allocateCdpPorts(
  slots: readonly CdpSlot[],
  basePort: number,
): Promise<CdpPorts> {
  const ports: Partial<Record<CdpSlot, number>> = {};
  let candidate = basePort;
  for (const slot of slots) {
    while (candidate <= 65535 && !(await isPortFree(candidate))) candidate++;
    if (candidate > 65535) {
      throw new Error(
        `shaka-perf troubleshoot: no free CDP port at or above ${basePort} for "${slot}".`,
      );
    }
    ports[slot] = candidate;
    candidate++;
  }
  return ports;
}

export interface CdpSessionBrowser {
  readonly slot: CdpSlot;
  readonly endpoint: string;
}

export interface CdpSession {
  /** The parked CLI. A manifest whose pid is gone is a finished session. */
  readonly pid: number;
  readonly test: string;
  readonly viewport: string;
  readonly headless: boolean;
  /** Lets a driving command match the visreg browser's two tabs to a side. */
  readonly controlURL: string;
  readonly experimentURL: string;
  readonly browsers: readonly CdpSessionBrowser[];
}

export const CDP_SESSION_FILENAME = 'troubleshoot-session.json';

const CDP_SLOTS: readonly CdpSlot[] = ['visreg', 'perf:control', 'perf:experiment'];

export function describeCdpBrowsers(ports: CdpPorts): CdpSessionBrowser[] {
  return CDP_SLOTS
    .filter((slot) => ports[slot] != null)
    .map((slot) => ({ slot, endpoint: cdpEndpoint(ports[slot] as number) }));
}

export function writeCdpSessionFile(resultsRoot: string, session: CdpSession): string {
  const file = path.join(resultsRoot, CDP_SESSION_FILENAME);
  fs.mkdirSync(resultsRoot, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  return file;
}

