/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { AsyncResource } from 'node:async_hooks';
import { fork, type ChildProcess } from 'node:child_process';
import { closeSync } from 'node:fs';
import { join } from 'node:path';
import { throwIfCancelled, type RaceCancellation } from 'race-cancellation';
import { attachLatestTestAnnotation } from '../../test-annotation';

import { Benchmark, BenchmarkSampler, type SamplingMode } from './run';
import type { LighthouseBenchmarkOptions, NavigationSample } from './lighthouse-config';
import type { AbTestDefinition } from './ab-test-registry';
import { withLogPrefix } from '../../visreg/core/util/testContext';
import { formatLogPrefix, type Group } from '../../pipeline/log-prefix-format';
import type { LogFrame, WorkerLogFrame } from './worker-log';

// stdio slots 0-3 are stdin, stdout, stderr, and Node's IPC channel.
// Slot 4 is reserved for the worker-to-worker barrier synchronization fd.
const BARRIER_SYNCHRONIZATION_FD_INDEX = 4;

export function lighthouseWorkerEnvironment(
  options: Pick<LighthouseBenchmarkOptions, 'headed' | 'realChrome' | 'viewport'>,
  samplingMode: SamplingMode,
): NodeJS.ProcessEnv {
  const forceRealChromeHeadless = options.realChrome?.headless === true;
  return {
    SHAKA_PERF_BARRIER_SYNCHRONIZATION_FD: String(BARRIER_SYNCHRONIZATION_FD_INDEX),
    SHAKA_PERF_SAMPLING_MODE: samplingMode,
    SHAKA_PERF_HEADED: options.headed && !forceRealChromeHeadless ? '1' : '0',
    SHAKAPERF_REAL_CHROME: options.realChrome ? '1' : '0',
    SHAKA_PERF_VIEWPORT_FORM_FACTOR: options.viewport.formFactor,
  };
}

export function warnIfRealChromeHeadlessOverridesHeaded(
  options: Pick<LighthouseBenchmarkOptions, 'headed' | 'realChrome'>,
): void {
  if (options.headed && options.realChrome?.headless && !realChromeHeadlessWarningEmitted) {
    realChromeHeadlessWarningEmitted = true;
    console.warn(
      'SHAKAPERF_REAL_CHROME_HEADLESS=1 overrides --headed for the audit browsers',
    );
  }
}

let realChromeHeadlessWarningEmitted = false;

interface ResultMessage {
  type: 'result';
  sample: NavigationSample;
}

interface ErrorMessage {
  type: 'error';
  message: string;
  stack: string;
  /** Mirror of `ErrorFrame.failureMediaName` from worker-log.ts. */
  failureMediaName?: string;
  /** Mirror of `ErrorFrame.lastAnnotation` from worker-log.ts. */
  lastAnnotation?: string;
}

interface ReadyMessage {
  type: 'ready';
}

type WorkerControlMessage = ResultMessage | ErrorMessage | ReadyMessage;
type WorkerMessage = WorkerControlMessage | WorkerLogFrame;

interface LighthouseWorkerSampleState {
  testFile: string | null;
  testName: string;
  targetUrl: string;
  options: LighthouseBenchmarkOptions;
}

function isLogFrame(msg: WorkerMessage): msg is LogFrame {
  return msg.type === 'log';
}

/**
 * Attach an IPC log forwarder bound to the caller's current async scope.
 * The bound listener replays `consoleCaptureStorage` + any `withLogPrefix`
 * scopes the caller had active when `attachLogForwarder` ran, so the
 * shared console-capture wrap composes the subject + prefix columns
 * exactly as for a natively-scoped emit. Returns a detach function.
 */
function attachLogForwarder(worker: ChildProcess): () => void {
  const listener = AsyncResource.bind((msg: WorkerMessage) => {
    if (!isLogFrame(msg)) return;
    const emit = msg.level === 'warn'
      ? console.warn
      : msg.level === 'error'
        ? console.error
        : console.log;
    emit(msg.message);
  });
  worker.on('message', listener);
  return () => worker.off('message', listener);
}

/**
 * One-shot waiter for a control message. Log frames flow through the always-on
 * listener installed in `setup()`, so they intentionally do NOT resolve this
 * promise — only ready/result/error do.
 */
function waitForMessage(worker: ChildProcess): Promise<WorkerControlMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (msg: WorkerMessage) => {
      if (isLogFrame(msg)) return;
      cleanup();
      resolve(msg);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Worker exited unexpectedly with code ${code}`));
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('exit', onExit);
    };
    worker.on('message', onMessage);
    worker.on('exit', onExit);
  });
}

function isWorkerAlive(worker: ChildProcess): boolean {
  return worker.connected && worker.exitCode === null && worker.signalCode === null;
}

function safeSend(worker: ChildProcess, msg: object): boolean {
  if (!isWorkerAlive(worker)) return false;
  try {
    return worker.send(msg);
  } catch {
    return false;
  }
}

// Three-phase dispose budget. The graceful phase covers Chrome teardown
// (chrome-launcher's .kill() can take a couple seconds under load); the
// SIGTERM-escalation phase covers workers that ignored the IPC message but
// still honour signals; SIGKILL is the uncatchable final hammer.
const GRACEFUL_DISPOSE_TIMEOUT_MS = 5000;
const SIGTERM_ESCALATION_TIMEOUT_MS = 2000;
const SIGKILL_FINAL_WAIT_MS = 2000;

function waitForWorkerExit(worker: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (worker.exitCode !== null || worker.signalCode !== null) {
      resolve();
      return;
    }
    worker.once('exit', () => resolve());
  });
}

async function raceExit(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    exited.then(() => 'exited' as const),
    new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return result === 'exited';
}

/**
 * Drive a Lighthouse worker subprocess to actual exit, escalating from
 * "polite IPC dispose message" through SIGTERM to SIGKILL. Resolves only
 * after `exit` has fired — *not* after a signal has been sent. The previous
 * implementation sent SIGTERM at the timeout and resolved synchronously,
 * which meant a worker that ignored SIGTERM (or whose Chrome was hung in a
 * blocking syscall) would survive while the parent moved on, leaking both
 * the Node subprocess and its Chrome grandchild.
 *
 * Returns when the worker exits OR when SIGKILL has been sent and a short
 * final wait elapses (the kernel should reap SIGKILLed processes promptly;
 * if it hasn't, a warning is logged and we proceed to avoid wedging the
 * parent on an uninterruptible-sleep child).
 */
async function disposeWorkerSubprocess(worker: ChildProcess): Promise<void> {
  if (worker.exitCode !== null || worker.signalCode !== null) return;

  const exited = waitForWorkerExit(worker);

  if (isWorkerAlive(worker)) {
    safeSend(worker, { type: 'dispose' });
  }
  if (await raceExit(exited, GRACEFUL_DISPOSE_TIMEOUT_MS)) return;

  if (!worker.killed) worker.kill('SIGTERM');
  if (await raceExit(exited, SIGTERM_ESCALATION_TIMEOUT_MS)) return;

  worker.kill('SIGKILL');
  if (await raceExit(exited, SIGKILL_FINAL_WAIT_MS)) return;

  // SIGKILL is uncatchable, so this should only be reachable if the worker
  // is stuck in an uninterruptible kernel state (e.g. "D" in `ps`). Don't
  // block the parent further; the kernel will reap it eventually, and the
  // leak (if any) will show up in `shaka-perf processes list`.
  console.warn(
    `[lighthouse worker pid=${worker.pid}] did not exit within ` +
    `${SIGKILL_FINAL_WAIT_MS}ms after SIGKILL — leaving for kernel to reap.`,
  );
}


class OOPLighthouseSampler implements BenchmarkSampler<NavigationSample> {
  constructor(private worker: ChildProcess) {}

  async sample(
    sampleState: unknown,
    sampleIndex: number,
    workerIndex: number,
    raceCancellation: RaceCancellation,
  ): Promise<NavigationSample> {
    const state = assertLighthouseWorkerSampleState(sampleState);
    const detach = attachLogForwarder(this.worker);
    let settled = false;
    try {
      if (!safeSend(this.worker, {
        type: 'sample',
        sampleIndex,
        workerIndex,
        ...state,
      })) {
        throw new Error('lighthouse worker died before it could sample');
      }
      // When the pool fires its race-cancellation (hard timeout / poison),
      // nudge the worker to abort the in-flight sample instead of abandoning
      // the wait here. The worker then runs its own failure path — stopping and
      // saving the screencast — and replies with an error frame carrying
      // `failureMediaName`, so the video-bearing error wins the pool's
      // post-timeout grace window rather than the generic `task timeout`
      // rejection. The `never`-resolving task settles only on cancellation; the
      // `settled` guard stops a late cancel (e.g. pool dispose) from aborting a
      // subsequent sample on this reused worker.
      void raceCancellation(new Promise<never>(() => { /* cancel-only */ })).then(() => {
        if (!settled) safeSend(this.worker, { type: 'abort' });
      });
      const msg = await waitForMessage(this.worker);
      if (msg.type === 'error') {
        const base = new Error(msg.message);
        base.stack = msg.stack;
        const err = attachLatestTestAnnotation(base, msg.lastAnnotation);
        if (msg.failureMediaName) {
          (err as Error & { failureMediaName?: string }).failureMediaName = msg.failureMediaName;
        }
        throw err;
      }
      return (msg as ResultMessage).sample;
    } finally {
      settled = true;
      detach();
    }
  }

  async dispose(): Promise<void> {
    await disposeWorkerSubprocess(this.worker);
  }
}

function assertLighthouseWorkerSampleState(sampleState: unknown): LighthouseWorkerSampleState {
  if (
    typeof sampleState === 'object' &&
    sampleState !== null &&
    'testName' in sampleState &&
    'targetUrl' in sampleState &&
    'options' in sampleState
  ) {
    return sampleState as LighthouseWorkerSampleState;
  }
  throw new Error('Invalid Lighthouse worker sample state');
}

export default function createLighthouseBenchmark(
  group: Group,
  testDef: AbTestDefinition,
  options: LighthouseBenchmarkOptions,
): Benchmark<NavigationSample> {
  const sampleState: LighthouseWorkerSampleState = {
    testFile: testDef.file,
    testName: testDef.name,
    targetUrl: options.targetUrl,
    options: { ...options, isControl: group === 'control' },
  };
  return {
    group,
    sampleState,
    workerReuseKey: options.realChrome ? options.viewport.formFactor : undefined,
    async setup(raceCancellation, barrierSynchronizationFd: number, samplingMode: SamplingMode) {
      const workerPath = join(__dirname, 'lighthouse-worker-entry.js');
      warnIfRealChromeHeadlessOverridesHeaded(options);
      // stdio: stdin/stdout/stderr inherit so IPC-dead fallback writes still
      // surface on the parent terminal. The worker entrypoint reroutes normal
      // console/stdout/stderr output to IPC log frames.
      const workerEnvironment = lighthouseWorkerEnvironment(options, samplingMode);
      let worker: ChildProcess;
      try {
        worker = fork(workerPath, [], {
          stdio: ['inherit', 'inherit', 'inherit', 'ipc', barrierSynchronizationFd],
          env: {
            ...process.env,
            ...workerEnvironment,
          },
        });
      } finally {
        try { closeSync(barrierSynchronizationFd); } catch { /* child_process may already close it */ }
      }

      worker.on('error', (err) => {
        console.error(`[lighthouse worker ${group}] ${err.message}`);
      });

      // Setup-phase log forwarder + send/await ready, all scoped in the
      // worker's group so any log emitted during setup picks up the
      // [group] column via the shared prefix-source pipeline.
      return withLogPrefix(formatLogPrefix(group), async () => {
        const detach = attachLogForwarder(worker);
        try {
          if (!safeSend(worker, {
            type: 'setup',
          })) {
            throw new Error('lighthouse worker died before setup could be sent');
          }

          const ready = throwIfCancelled(await raceCancellation(waitForMessage(worker)));
          if (ready.type === 'error') {
            const err = new Error(ready.message);
            err.stack = ready.stack;
            throw err;
          }
          return new OOPLighthouseSampler(worker);
        } catch (err) {
          await disposeWorkerSubprocess(worker);
          throw err;
        } finally {
          detach();
        }
      });
    }
  };
}
