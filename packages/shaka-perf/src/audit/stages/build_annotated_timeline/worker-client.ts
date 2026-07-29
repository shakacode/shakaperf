/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  ComputeDebugAllFramesResult,
  ComputeFramesResult,
  FrameMetadata,
  SyncScreencastToTraceResult,
  WorkerRequest,
  WorkerResponse,
} from './worker-protocol';

/**
 * Thin RPC wrapper over the long-lived annotated-timeline worker. The
 * worker is spawned on construction, holds the parsed profile / kept
 * frames / etc. across calls, and is terminated by `dispose`. Each
 * method posts one `WorkerRequest` and resolves with the matching
 * `WorkerResponse.value` (or rejects with the worker's error).
 *
 * Concurrency note: the worker's JS thread can multiplex requests
 * (each handler is async and yields on `await sharp(...)`), so it's
 * safe to have multiple `writeFrameImage` calls in flight from the
 * parent if you want intra-worker parallelism. The audit engine
 * intentionally serialises them so cross-audit fairness wins over
 * within-audit fan-out (see engine.ts).
 */
export class TimelineWorkerClient {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private terminated = false;

  constructor() {
    const workerPath = path.join(__dirname, 'worker-entry.js');
    this.worker = new Worker(workerPath);
    this.worker.on('message', (msg: WorkerResponse) => this.dispatchResponse(msg));
    this.worker.on('error', (err) => this.failAll(err));
    this.worker.on('exit', (code) => {
      if (this.terminated) return;
      // Unsolicited exit: a step body threw synchronously / segfaulted /
      // hit OOM. Resolve every outstanding RPC with the exit code so
      // the host pipeline doesn't hang waiting for a reply that will
      // never come.
      this.failAll(new Error(`annotated-timeline worker exited with code ${code}`));
    });
  }

  /**
   * Drop the previous build's accumulated state in the worker so V8
   * inside the worker can collect it before the next build allocates.
   * Cheap (no native work) — safe to call before every audit, including
   * the first.
   */
  reset(): Promise<void> {
    return this.request<void>({ type: 'reset', params: {} });
  }

  parseProfile(profilePath: string): Promise<{ hasViewport: boolean }> {
    return this.request<{ hasViewport: boolean }>({
      type: 'parseProfile',
      params: { profilePath },
    });
  }

  loadScreencastVideo(profilePath: string): Promise<{ shotCount: number }> {
    return this.request<{ shotCount: number }>({
      type: 'loadScreencastVideo',
      params: { profilePath },
    });
  }

  syncScreencastToTrace(limitVideoFramesCount: number): Promise<SyncScreencastToTraceResult> {
    return this.request<SyncScreencastToTraceResult>({
      type: 'syncScreencastToTrace',
      params: { limitVideoFramesCount },
    });
  }

  computeFrames(profilePath: string, interactionsPath?: string): Promise<ComputeFramesResult> {
    return this.request<ComputeFramesResult>({
      type: 'computeFrames',
      params: { profilePath, interactionsPath },
    });
  }

  computeDebugAllFrames(outDir: string, metadataPath: string): Promise<ComputeDebugAllFramesResult> {
    return this.request<ComputeDebugAllFramesResult>({
      type: 'computeDebugAllFrames',
      params: { outDir, metadataPath },
    });
  }

  writeFrameImage(index: number, outDir: string): Promise<void> {
    return this.request<void>({
      type: 'writeFrameImage',
      params: { index, outDir },
    });
  }

  writeFramesMetadata(opts: { outputPath: string }): Promise<FrameMetadata[]> {
    return this.request<FrameMetadata[]>({
      type: 'writeFramesMetadata',
      params: opts,
    });
  }

  async dispose(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    this.failAll(new Error('annotated-timeline worker disposed'));
    await this.worker.terminate().catch(() => undefined);
  }

  private request<T>(spec: Omit<WorkerRequest, 'id'>): Promise<T> {
    if (this.terminated) {
      return Promise.reject(new Error('annotated-timeline worker already disposed'));
    }
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ ...spec, id } as WorkerRequest);
    });
  }

  private dispatchResponse(msg: WorkerResponse): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.type === 'result') {
      entry.resolve(msg.value);
      return;
    }
    const err = new Error(msg.message);
    if (msg.stack) err.stack = msg.stack;
    entry.reject(err);
  }

  private failAll(err: Error): void {
    for (const entry of this.pending.values()) entry.reject(err);
    this.pending.clear();
  }
}
