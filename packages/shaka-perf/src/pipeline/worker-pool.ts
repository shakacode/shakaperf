/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { AsyncResource } from 'node:async_hooks';
import { Instance } from 'chalk';
import { cancellableRace, type Cancel, type RaceCancellation } from 'race-cancellation';
import {
  getLatestTestAnnotation,
  messageWithLatestTestAnnotation,
  stackWithLatestTestAnnotation,
} from '../test-annotation';

// Worker-pool log lines are captured into per-task buffers that get
// embedded in the HTML report. Use forced-colour chalk so retried-failure
// banners survive the trip to the report (where the shell parses ANSI back
// into styled spans) — the default `chalk` strips colours under non-TTY
// stdio (CI, yarn wrappers, pipes).
const chalk = new Instance({ level: 2 });

/**
 * After a hard timeout fires, hold off on synthesising the generic
 * `task timeout after Nms` rejection for this long — giving the task's own
 * cancellation-aware code a chance to surface a richer error (e.g. a
 * `failureMediaName`-bearing error whose screencast the Lighthouse worker
 * encodes on the abort path). The window has to cover that encode — a
 * full-load screencast can be a couple-MB mp4 and ffmpeg needs a few seconds —
 * not just "one screenshot + write to disk", or the rich error lands too late
 * and the media-less generic timeout wins instead.
 */
const TIMEOUT_CANCEL_GRACE_MS = 15000;

/**
 * Brand a hard-timeout rejection so {@link WorkerPool.runOnWorker} can tell it
 * apart from an ordinary crash and treat it as terminal — see the no-retry
 * rationale there.
 */
const POOL_TASK_TIMED_OUT = Symbol('poolTaskTimedOut');

function markTimedOut(err: unknown): unknown {
  if (err && typeof err === 'object') {
    (err as Record<symbol, unknown>)[POOL_TASK_TIMED_OUT] = true;
  }
  return err;
}

function isTimedOut(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as Record<symbol, unknown>)[POOL_TASK_TIMED_OUT] === true;
}

export type DisposeWorkerState = (state: Record<string, unknown>) => Promise<void> | void;
export interface PoolWorkerState extends Record<string, unknown> {
  readonly workerIndex: number;
}
export type WorkerTask<T> = (state: PoolWorkerState, raceCancellation: RaceCancellation) => Promise<T>;

export interface WorkerTaskProgressSink {
  onTaskSubmitted(): void;
  onTaskStarted(): void;
  onTaskSettled(): void;
  onTaskFailed(): void;
}

/**
 * Everything the pool applies to one task. A single object rather than three
 * loose options, so a task's budget travels as a unit: `submit` resolves it
 * once, the job carries it, and every use site reads it off the job. Adding a
 * knob is a field here — not another pool option, another async-local channel,
 * and another `QueuedJob` field.
 */
export interface TaskLimits {
  /**
   * Hard cap on the task's wall-clock. On expiry the pool fires the task's
   * race-cancellation (cooperative subsystems exit promptly) and counts the
   * attempt as a failure, so it flows through the same poison path as a
   * crash. `0` disables it.
   */
  readonly timeoutMs: number;
  /** Crash-retries, re-run on the SAME worker (see `runOnWorker`). */
  readonly retries: number;
  /** Pause between those retries, in ms. */
  readonly retryDelay: number;
}

export interface WorkerPoolOptions {
  currentTaskProgress?: () => WorkerTaskProgressSink | undefined;
  /**
   * The limits for the task being submitted, read at SUBMIT time out of the
   * submitting async context — the same trick as `currentTaskProgress`. The
   * runner publishes each unit's, derived from that unit's EFFECTIVE config,
   * so every budget a test overrides applies to that test's tasks instead of
   * being silently dropped. Returning undefined falls back to `limits`.
   */
  currentTaskLimits?: () => TaskLimits | undefined;
  /**
   * Applied to a task submitted outside any published context. Required, and
   * deliberately without a default: the only value a pool could fall back to
   * is "no cap, no retries", and a pool that quietly stops enforcing timeouts
   * because a caller forgot an option is the failure this whole seam exists to
   * prevent. State the budget, even when it is zero.
   */
  limits: TaskLimits;
}

export interface SubmitOptions {
  key?: string;
}

export type WorkerPoolTask<T> =
  | WorkerTask<T>
  | (SubmitOptions & { run: WorkerTask<T> });

export interface PoolSnapshot {
  /** Total tasks pushed to the pool so far (queue + in-flight + done). */
  submitted: number;
  /** Tasks settled (resolved or rejected). */
  completed: number;
  /** Wall-clock ms when the pool was constructed. */
  startedAt: number;
  /** Caller-supplied advance count for this phase. */
  expectedTotal: number | null;
  /** Worker capacity — total number of slots in the pool. */
  parallelism: number;
  /** Workers currently executing a task (busy === true). */
  active: number;
  /** Tasks waiting in the queue for an open worker. */
  queued: number;
}

interface InternalWorker {
  busy: boolean;
  state: PoolWorkerState;
  disposers: Set<DisposeWorkerState>;
  disposerStages: Map<DisposeWorkerState, string | undefined>;
  currentStageName: string | undefined;
  /**
   * Consecutive task failures on this worker, reset to 0 on the next
   * successful task. When this exceeds the pool's retry budget, the
   * worker is considered wedged and we cancel the entire test+viewport
   * (every submission sharing the failing task's key).
   */
  consecutiveFailures: number;
}

interface SubmitOrchestrator {
  key?: string;
  cancelled: boolean;
  terminal: boolean;
  started: boolean;
  progress?: WorkerTaskProgressSink;
  resolveOuter(value: unknown): void;
  rejectOuter(reason: unknown): void;
  runInSubmitContext<T>(fn: () => T): T;
  destroySubmitContext(): void;
  /**
   * Fires the per-task race-cancellation. Any in-flight `job.run` that
   * threads `raceCancellation` into its async work (e.g. the Lighthouse
   * sampler's `withRaceTimeout`) will resolve to a Cancellation marker
   * instead of waiting for its natural completion, freeing the worker.
   * Safe to call after settlement; the cancellableRace function is idempotent.
   */
  cancel: Cancel;
  /**
   * Set while the orchestrator's runOnWorker loop is sleeping between
   * retry attempts. Calling this wakes the sleeper synchronously; the
   * loop then re-checks `disposed` and `cancelled` before its next attempt.
   * Undefined any other time (queued, in job.run, terminal).
   */
  wakeRetry?: () => void;
}

interface QueuedJob<T> {
  run(state: PoolWorkerState): Promise<T>;
  orchestrator: SubmitOrchestrator;
  stageName: string | undefined;
  /** THIS task's budget, resolved at submit time and fixed across its retries. */
  limits: TaskLimits;
}

function reasonMessage(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function firstLine(message: string): string {
  const newline = message.indexOf('\n');
  return newline === -1 ? message : message.slice(0, newline);
}

/**
 * Wraps `cause` with a higher-level "exhausted retries" message and composes
 * `wrapped.stack` as `<wrapper line>\nCaused by: <cause stack>`. The report's
 * top-line frame then points at the underlying failure (ffmpeg spawn, LH
 * navigation, …) instead of this retry loop. `Error.cause` is preserved
 * so tooling that walks it programmatically still reaches the original.
 *
 * `cause` may be a string, plain object, or null (anything `reject()` was
 * called with). For non-Error causes we fall back to a stringified
 * representation; a literal `null` produces `Caused by: null`, which is
 * intentional — better a flagged dead-end than a silent disappearance.
 */
function wrapWithCause(message: string, cause: unknown): Error {
  const wrapped = new Error(message, { cause });
  const causeStack = cause instanceof Error
    ? (cause.stack ?? `${cause.name}: ${cause.message}`)
    : (typeof cause === 'string' ? cause : safeStringify(cause));
  wrapped.stack = `${wrapped.name}: ${message}\n` +
    `Caused by: ${causeStack}`;
  return wrapped;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function progressStageName(progress: WorkerTaskProgressSink | undefined): string | undefined {
  // Runner-owned progress sinks carry the stage name as metadata. Keeping it
  // off the public submit API lets stage code keep using plain pool.submit().
  const maybeProgress = progress as (WorkerTaskProgressSink & { stageName?: unknown }) | undefined;
  return typeof maybeProgress?.stageName === 'string'
    ? maybeProgress.stageName
    : undefined;
}

export class WorkerPool {
  private readonly workers: InternalWorker[];
  private readonly queue: Array<QueuedJob<unknown>> = [];
  private readonly inFlight = new Set<Promise<void>>();
  private readonly orchestrators = new Set<SubmitOrchestrator>();
  private disposed = false;
  private submittedCount = 0;
  private completedCount = 0;
  private expected: number | null = null;
  private readonly startedAt = Date.now();
  private readonly defaultLimits: TaskLimits;

  onProgressChange?: (snapshot: PoolSnapshot) => void;

  constructor(
    parallelism: number,
    private readonly options: WorkerPoolOptions,
  ) {
    this.workers = Array.from(
      { length: Math.max(1, parallelism) },
      (_unused, workerIndex) => ({
        busy: false,
        state: { workerIndex },
        disposers: new Set(),
        disposerStages: new Map(),
        currentStageName: undefined,
        consecutiveFailures: 0,
      }),
    );
    this.defaultLimits = options.limits;
  }

  setExpectedTotal(n: number | null): void {
    this.expected = n;
    this.notify();
  }

  snapshot(): PoolSnapshot {
    let active = 0;
    for (const worker of this.workers) if (worker.busy) active += 1;
    return {
      submitted: this.submittedCount,
      completed: this.completedCount,
      startedAt: this.startedAt,
      expectedTotal: this.expected,
      parallelism: this.workers.length,
      active,
      queued: this.queue.length,
    };
  }

  getWorkerState<T extends PoolWorkerState>(
    state: PoolWorkerState,
    disposeWorkerState: DisposeWorkerState,
  ): T {
    const worker = this.workers.find((candidate) => candidate.state === state);
    if (!worker) {
      throw new Error('getWorkerState() received state from another WorkerPool');
    }
    worker.disposers.add(disposeWorkerState);
    worker.disposerStages.set(disposeWorkerState, worker.currentStageName);
    return state as T;
  }

  submit<T>(run: WorkerTask<T>, keyOrOptions?: string | SubmitOptions): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('WorkerPool has been disposed'));
    }
    const submitOptions = typeof keyOrOptions === 'string'
      ? { key: keyOrOptions }
      : keyOrOptions;
    const progress = this.options.currentTaskProgress?.();
    const stageName = progressStageName(progress);
    // Resolved HERE, in the submitter's context, not when the job later starts:
    // by then we're on whichever worker freed up and the unit's context is gone.
    const limits = this.options.currentTaskLimits?.() ?? this.defaultLimits;
    progress?.onTaskSubmitted();
    this.submittedCount += 1;
    // Capture the caller's async context now. `pump` and retry handling run
    // later from whichever task just freed a worker, so the pool must replay
    // this context for both the task body and its lifecycle logs/callbacks.
    const submitResource = new AsyncResource('WorkerPoolTask');
    const runInSubmitContext = <R>(fn: () => R): R =>
      submitResource.runInAsyncScope(fn);
    const [raceCancellation, cancel] = cancellableRace();
    const boundRun = (state: PoolWorkerState): Promise<T> =>
      runInSubmitContext(() => run(state, raceCancellation));
    return new Promise<T>((resolve, reject) => {
      const orchestrator: SubmitOrchestrator = {
        key: submitOptions?.key,
        cancelled: false,
        terminal: false,
        started: false,
        progress,
        resolveOuter: resolve as (value: unknown) => void,
        rejectOuter: reject,
        runInSubmitContext,
        destroySubmitContext: () => submitResource.emitDestroy(),
        cancel,
      };
      this.orchestrators.add(orchestrator);
      this.queue.push({ run: boundRun, orchestrator, stageName, limits });
      this.pump();
      this.notify();
    });
  }

  async all<T>(tasks: readonly WorkerPoolTask<T>[]): Promise<T[]> {
    this.setExpectedTotal(tasks.length);
    return Promise.all(tasks.map((task) => {
      if (typeof task === 'function') return this.submit(task);
      return this.submit(task.run, task);
    }));
  }

  cancel(key: string, reason: unknown): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].orchestrator.key === key) this.queue.splice(i, 1);
    }
    for (const orchestrator of [...this.orchestrators]) {
      if (orchestrator.key === key) this.cancelOrchestrator(orchestrator, reason);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const disposeReason = new Error('WorkerPool disposed before task started');
    const pending = this.queue.splice(0);
    for (const job of pending) {
      this.settleTerminal(job.orchestrator, () =>
        job.orchestrator.rejectOuter(disposeReason),
      );
    }
    // Wake sleeping retries AND fire race-cancellation on every live
    // orchestrator so in-flight `job.run` work returns promptly instead
    // of blocking dispose on a 30s LH navigation.
    for (const orchestrator of [...this.orchestrators]) {
      orchestrator.wakeRetry?.();
      orchestrator.cancel(disposeReason.message);
      this.settleTerminal(orchestrator, () =>
        orchestrator.rejectOuter(disposeReason),
      );
    }
    await Promise.allSettled([...this.inFlight]);
    await Promise.all(this.workers.map((worker) => this.disposeWorker(worker)));
  }

  private cancelOrchestrator(orchestrator: SubmitOrchestrator, reason: unknown): void {
    if (orchestrator.terminal) return;
    orchestrator.cancelled = true;
    orchestrator.wakeRetry?.();
    // Fire the per-task race-cancellation so in-flight `job.run` work that
    // accepts `raceCancellation` (LH samplers, etc.) returns immediately
    // instead of running to natural completion on an already-doomed task.
    orchestrator.cancel(reasonMessage(reason));
    this.settleTerminal(orchestrator, () => orchestrator.rejectOuter(reason));
  }

  private settleTerminal(
    orchestrator: SubmitOrchestrator,
    settle: () => void,
  ): void {
    if (orchestrator.terminal) return;
    orchestrator.terminal = true;
    try {
      orchestrator.runInSubmitContext(() => {
        settle();
        orchestrator.progress?.onTaskSettled();
      });
      this.completedCount += 1;
      this.orchestrators.delete(orchestrator);
    } finally {
      orchestrator.destroySubmitContext();
    }
  }

  private notify(): void {
    this.onProgressChange?.(this.snapshot());
  }

  private pump(): void {
    if (this.disposed) return;
    for (const worker of this.workers) {
      if (worker.busy) continue;
      const job = this.takeNextJob();
      if (!job) return;
      worker.busy = true;
      const run = job.orchestrator.runInSubmitContext(() =>
        this.runOnWorker(worker, job),
      ).finally(() => {
        worker.busy = false;
        this.inFlight.delete(run);
        this.pump();
        this.notify();
      });
      this.inFlight.add(run);
    }
  }

  /**
   * Retry on the same worker (NOT re-queued). If retries hopped to fresh
   * workers, `worker.consecutiveFailures` would reset on every attempt and
   * the retry budget would be unbounded.
   */
  private async runOnWorker(
    worker: InternalWorker,
    job: QueuedJob<unknown>,
  ): Promise<void> {
    const orchestrator = job.orchestrator;
    if (!orchestrator.started) {
      orchestrator.started = true;
      orchestrator.progress?.onTaskStarted();
    }
    while (true) {
      if (this.disposed || orchestrator.cancelled) {
        worker.consecutiveFailures = 0;
        // settleTerminal is already done (cancelOrchestrator / dispose);
        // this call is a noop, the rejection reason is whatever they set.
        this.settleTerminal(orchestrator, () => orchestrator.rejectOuter(undefined));
        return;
      }
      try {
        // `job.run` was AsyncResource-bound at submit time; calling it now
        // replays the caller's full async context (logger, prefix scopes).
        const value = await this.runWithStageOwner(job, worker);
        worker.consecutiveFailures = 0;
        this.settleTerminal(orchestrator, () => orchestrator.resolveOuter(value));
        return;
      } catch (err) {
        orchestrator.progress?.onTaskFailed();
        // Failing attempt likely poisoned the worker (crashed LH subprocess,
        // leftover Chrome, half-bound sampler). Drop its state before reuse.
        await this.disposeWorker(worker);
        const annotation = getLatestTestAnnotation(err);
        const reason = err instanceof Error
          ? messageWithLatestTestAnnotation(err.message, annotation)
          : messageWithLatestTestAnnotation(String(err), annotation);
        const stackOrMessage = err instanceof Error
          ? (stackWithLatestTestAnnotation(err, annotation) ?? reason)
          : reason;
        const reasonSummary = firstLine(reason);
        // Log EVERY failed attempt — including the final one that exhausts
        // the budget — so the report's logs panel shows the full retry
        // history with stacks. Previously this lived after the
        // retries-exhausted branch, which `return`s, so the final attempt's
        // stack only made it into the poison-wrapped error and never into
        // `outcome.logs`. Denominator is total attempts (retries + 1) so
        // "attempt 3/3" reads as "third of three" rather than the old
        // ambiguous "third of two retries".
        worker.consecutiveFailures += 1;
        const totalAttempts = job.limits.retries + 1;
        console.log(
          chalk.red(`task failed (worker ${worker.state.workerIndex} attempt ${worker.consecutiveFailures}/${totalAttempts}):\n${stackOrMessage}`),
        );
        // A hard timeout is terminal — never retried. The pool already fired
        // this task's race-cancellation when the timeout struck, so every
        // retry's setup would immediately throw a generic `CancellationError`
        // that overwrites THIS attempt's richer error (e.g. one carrying a
        // screencast `failureMediaName`); and re-running a task that already
        // blew its wall-clock budget just burns more of it. Surface this error
        // now, the same way the retries-exhausted path does.
        const timedOut = isTimedOut(err);
        if (timedOut || worker.consecutiveFailures > job.limits.retries) {
          const detail = timedOut
            ? `task exceeded its ${job.limits.timeoutMs}ms budget`
            : `exhausted ${totalAttempts} consecutive attempts`;
          const poison = wrapWithCause(
            `worker ${worker.state.workerIndex} ${detail}; ` +
            `cancelling test+viewport. Last error: ${reasonSummary}`,
            err,
          );
          worker.consecutiveFailures = 0;
          if (orchestrator.key != null) this.cancel(orchestrator.key, poison);
          else this.settleTerminal(orchestrator, () => orchestrator.rejectOuter(poison));
          return;
        }
        if (job.limits.retryDelay > 0) await this.sleepForRetry(orchestrator, job.limits.retryDelay);
      }
    }
  }

  private async runWithTimeout<T>(
    job: QueuedJob<T>,
    worker: InternalWorker,
  ): Promise<T> {
    const { timeoutMs } = job.limits;
    if (timeoutMs <= 0) return job.run(worker.state);

    // Materialise the task's outcome as a settled marker so we can race it
    // twice (hard timeout, then grace) without losing the original result.
    type Settled<U> = { ok: true; value: U } | { ok: false; err: unknown };
    const settledTask: Promise<Settled<T>> = job.run(worker.state).then(
      (value) => ({ ok: true, value }),
      (err) => ({ ok: false, err }),
    );

    // Phase 1: task vs hard timeout.
    let hardTimer: NodeJS.Timeout | undefined;
    const phase1 = await Promise.race([
      settledTask,
      new Promise<'timed-out'>((resolve) => {
        hardTimer = setTimeout(() => resolve('timed-out'), timeoutMs);
      }),
    ]);
    if (hardTimer) clearTimeout(hardTimer);
    if (phase1 !== 'timed-out') {
      if (phase1.ok) return phase1.value;
      throw phase1.err;
    }

    // Phase 2: timeout fired — fire cooperative cancel and give the task a
    // grace window to surface its OWN rejection (which may carry a
    // `StageFailureError` with a screenshot the stage captured before the
    // browser tears down). Only synthesize the generic timeout error if the
    // task hasn't settled by the end of the grace window.
    job.orchestrator.cancel(`task timeout after ${timeoutMs}ms`);
    let graceTimer: NodeJS.Timeout | undefined;
    const phase2 = await Promise.race([
      settledTask,
      new Promise<'grace-elapsed'>((resolve) => {
        graceTimer = setTimeout(() => resolve('grace-elapsed'), TIMEOUT_CANCEL_GRACE_MS);
      }),
    ]);
    if (graceTimer) clearTimeout(graceTimer);
    if (phase2 === 'grace-elapsed') {
      throw markTimedOut(new Error(`task timeout after ${timeoutMs}ms`));
    }
    if (phase2.ok) return phase2.value;
    // The task surfaced its own rejection within the grace window (e.g. the
    // Lighthouse worker's abort-path error carrying a screencast
    // `failureMediaName`). Tag it as a timeout so it's treated as terminal,
    // not retried — retries would clobber this richer error with the
    // already-tripped race-cancellation's generic `CancellationError`.
    throw markTimedOut(phase2.err);
  }

  private async runWithStageOwner<T>(
    job: QueuedJob<T>,
    worker: InternalWorker,
  ): Promise<T> {
    worker.currentStageName = job.stageName;
    try {
      await this.disposeWorkerStateFromOtherStages(worker, job.stageName);
      return await this.runWithTimeout(job, worker);
    } finally {
      worker.currentStageName = undefined;
    }
  }

  private sleepForRetry(orchestrator: SubmitOrchestrator, delayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        orchestrator.wakeRetry = undefined;
        resolve();
      }, delayMs);
      orchestrator.wakeRetry = () => {
        clearTimeout(timer);
        orchestrator.wakeRetry = undefined;
        resolve();
      };
    });
  }

  // FIFO across the entire queue. Earlier `submit()` calls dequeue
  // first. Preferring later-stage tasks (the previous behaviour) drained
  // a single unit's downstream stages before the pool would touch other
  // units' upstream stages, producing depth-first thrash when downstream
  // stages submit many fine-grained tasks (e.g. per-frame composites in
  // build_annotated_timeline).
  private takeNextJob(): QueuedJob<unknown> | undefined {
    return this.queue.shift();
  }

  private async disposeWorkerStateFromOtherStages(
    worker: InternalWorker,
    stageName: string | undefined,
  ): Promise<void> {
    if (worker.disposers.size === 0) return;
    const staleDisposers = [...worker.disposers].filter((dispose) =>
      worker.disposerStages.get(dispose) !== stageName,
    );
    if (staleDisposers.length === 0) return;

    const state = worker.state;
    for (const dispose of staleDisposers) {
      worker.disposers.delete(dispose);
      worker.disposerStages.delete(dispose);
    }
    if (worker.disposers.size === 0) {
      worker.state = { workerIndex: state.workerIndex };
    }
    await Promise.all(staleDisposers.map((dispose) => dispose(state)));
  }

  private async disposeWorker(worker: InternalWorker): Promise<void> {
    if (worker.disposers.size === 0) return;
    const state = worker.state;
    const disposers = [...worker.disposers];
    worker.state = { workerIndex: state.workerIndex };
    worker.disposers.clear();
    worker.disposerStages.clear();
    worker.currentStageName = undefined;
    await Promise.all(disposers.map((dispose) => dispose(state)));
  }
}
