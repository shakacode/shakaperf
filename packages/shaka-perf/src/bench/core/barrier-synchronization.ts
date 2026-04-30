import { read, write } from 'node:fs';

import type { SamplingMode } from './run';

// Pre-navigation barrier between the control and experiment workers.
//
// Both workers are launched with one end of a Unix domain socket wired into a
// fixed FD slot (see create-lighthouse-benchmark.ts). The Lighthouse patch in
// patched-lighthouse/navigation-start.patch awaits __shakaperfBeforePageNavigate
// just before driving the page navigation; this module's job is to make that
// hook block until the peer worker reaches the same point, so the two
// navigations start simultaneously.
//
// The exchange is one byte each way over the socket: write a token (signalling
// "I'm here"), then read the peer's token (releasing on arrival).

export function installBeforePageNavigateBarrier(): void {
  const samplingMode = parseSamplingMode();
  const fd = parseBarrierSynchronizationFd();
  (globalThis as Record<string, unknown>).__shakaperfBeforePageNavigate = async () => {
    if (samplingMode !== 'simultaneous') return;
    if (fd === null) {
      throw new Error('Missing barrier synchronization fd for simultaneous sampling');
    }
    await synchronizeBarrierOnce(fd);
  };
}

function parseBarrierSynchronizationFd(): number | null {
  const raw = process.env.SHAKA_PERF_BARRIER_SYNCHRONIZATION_FD;
  if (raw === undefined) return null;
  const fd = Number(raw);
  if (!Number.isInteger(fd) || fd < 0) {
    throw new Error(`Invalid SHAKA_PERF_BARRIER_SYNCHRONIZATION_FD value: ${raw}`);
  }
  return fd;
}

function parseSamplingMode(): SamplingMode {
  const raw = process.env.SHAKA_PERF_SAMPLING_MODE;
  if (raw === 'sequential' || raw === 'simultaneous') return raw;
  throw new Error(`Invalid SHAKA_PERF_SAMPLING_MODE value: ${raw}`);
}

async function synchronizeBarrierOnce(fd: number): Promise<void> {
  await writeOne(fd);
  await readOne(fd);
}

async function writeOne(fd: number): Promise<void> {
  const byte = Buffer.of(1);
  while (true) {
    const retry = await new Promise<boolean>((resolve, reject) => {
      write(fd, byte, 0, 1, null, (err) => {
        if (isTryAgain(err)) resolve(true);
        else if (err) reject(err);
        else resolve(false);
      });
    });
    if (!retry) return;
    await waitTurn();
  }
}

async function readOne(fd: number): Promise<void> {
  const byte = Buffer.alloc(1);
  while (true) {
    const retry = await new Promise<boolean>((resolve, reject) => {
      read(fd, byte, 0, 1, null, (err, bytesRead) => {
        if (isTryAgain(err)) resolve(true);
        else if (err) reject(err);
        else if (bytesRead === 0) reject(new Error('barrier synchronization peer closed before release'));
        else resolve(false);
      });
    });
    if (!retry) return;
    await waitTurn();
  }
}

function isTryAgain(err: NodeJS.ErrnoException | null): boolean {
  return err?.code === 'EAGAIN' || err?.code === 'EWOULDBLOCK';
}

function waitTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
