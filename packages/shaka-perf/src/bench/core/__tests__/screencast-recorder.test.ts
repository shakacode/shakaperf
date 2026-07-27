/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import {
  screencastRecorder,
  startScreencastOnLighthouseSession,
  SUBSCRIBE_RETRY_DELAY_MS,
  SUBSCRIBE_RETRY_WINDOW_MS,
} from '../screencast-recorder';

describe('screencastRecorder', () => {
  afterEach(async () => {
    await screencastRecorder.stop();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retries the main-frame subscription while a swapped renderer attaches', async () => {
    jest.useFakeTimers();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    let startAttempts = 0;
    const sendCommand = jest.fn(async (method: string) => {
      if (method !== 'Page.startScreencast') return;
      startAttempts += 1;
      if (startAttempts === 2 || startAttempts === 3) {
        throw new Error('Not attached to an active page');
      }
    });
    const session = {
      sendCommand,
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    };

    const recording = await startScreencastOnLighthouseSession(session);
    expect(startAttempts).toBe(1);

    handlers.get('Page.frameNavigated')?.({ frame: { url: 'https://example.com' } });
    await jest.advanceTimersByTimeAsync(500);
    handlers.get('Page.screencastFrame')?.({
      data: 'captured-frame',
      sessionId: 1,
      metadata: { timestamp: Date.now() / 1000 },
    });

    expect(startAttempts).toBe(4);
    expect(recording.frames).toEqual([{ timeMs: 500, data: 'captured-frame' }]);
    expect(sendCommand).toHaveBeenCalledWith('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 500,
      maxHeight: 4096,
      everyNthFrame: 1,
    });
    await recording.stop();
  });

  it('uses the full retry window before abandoning a detached renderer', async () => {
    jest.useFakeTimers();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    let startAttempts = 0;
    const sendCommand = jest.fn(async (method: string) => {
      if (method !== 'Page.startScreencast') return;
      startAttempts += 1;
      if (startAttempts > 1) throw new Error('Not attached to an active page');
    });
    const session = {
      sendCommand,
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const recording = await startScreencastOnLighthouseSession(session);
    handlers.get('Page.frameNavigated')?.({ frame: { url: 'https://example.com' } });
    await jest.advanceTimersByTimeAsync(SUBSCRIBE_RETRY_WINDOW_MS);

    expect(startAttempts).toBe(1 + SUBSCRIBE_RETRY_WINDOW_MS / SUBSCRIBE_RETRY_DELAY_MS);
    expect(warn).toHaveBeenCalledWith(
      '[shaka-perf screencast] subscribe (after nav to https://example.com) failed:',
      expect.any(Error),
    );
    await recording.stop();
    warn.mockRestore();
  });

  it('does not retain frames or leave capture running when stop wins an in-flight retry', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    let startAttempts = 0;
    let resolveRetry: (() => void) | undefined;
    const sendCommand = jest.fn(async (method: string) => {
      if (method !== 'Page.startScreencast') return;
      startAttempts += 1;
      if (startAttempts === 2) {
        await new Promise<void>((resolve) => {
          resolveRetry = resolve;
        });
      }
    });
    const session = {
      sendCommand,
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    };

    const recording = await startScreencastOnLighthouseSession(session);
    handlers.get('Page.frameNavigated')?.({ frame: { url: 'https://example.com' } });
    await Promise.resolve();
    const stopPromise = recording.stop();
    resolveRetry?.();
    await stopPromise;
    handlers.get('Page.screencastFrame')?.({
      data: 'late-frame',
      sessionId: 2,
      metadata: { timestamp: Date.now() / 1000 },
    });

    expect(recording.frames).toEqual([]);
    expect(sendCommand.mock.calls.filter(([method]) => method === 'Page.stopScreencast'))
      .toHaveLength(2);
  });
});
