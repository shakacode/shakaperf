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
    screencastRecorder.record(false);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('starts capture through the public recorder entry point', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const sendCommand = jest.fn(async () => {});
    const session = {
      sendCommand,
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    };

    screencastRecorder.record(true);
    await screencastRecorder.onNavigate(session);
    await screencastRecorder.stop();

    expect(sendCommand).toHaveBeenCalledWith('Page.startScreencast', expect.any(Object));
    expect(sendCommand).toHaveBeenCalledWith('Page.stopScreencast');
  });

  it('ignores navigation while the public recorder is unarmed', async () => {
    const session = {
      sendCommand: jest.fn(async () => {}),
      on: jest.fn(),
      off: jest.fn(),
    };

    screencastRecorder.record(false);
    await screencastRecorder.onNavigate(session);

    expect(session.sendCommand).not.toHaveBeenCalled();
    expect(session.on).not.toHaveBeenCalled();
  });

  it('ignores an armed navigation without a Lighthouse session', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    screencastRecorder.record(true);
    await screencastRecorder.onNavigate();

    expect(warn).not.toHaveBeenCalled();
  });

  it('reports a save failure through the public recorder without throwing', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const session = {
      sendCommand: jest.fn(async () => {}),
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    screencastRecorder.record(true);
    await screencastRecorder.onNavigate(session);
    handlers.get('Page.screencastFrame')?.({
      data: 'not-a-jpeg',
      sessionId: 1,
      metadata: { timestamp: Date.now() / 1000 },
    });
    await screencastRecorder.stop();

    await expect(screencastRecorder.save('/unused', 'broken-frame')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[shaka-perf screencast] save failed for broken-frame: Input buffer contains unsupported image format',
    );
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

  it('clamps frames captured before the navigation anchor to zero', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const session = {
      sendCommand: jest.fn(async () => {}),
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    };

    const recording = await startScreencastOnLighthouseSession(session);
    handlers.get('Page.screencastFrame')?.({
      data: 'early-frame',
      sessionId: 1,
      metadata: { timestamp: 0 },
    });

    expect(recording.frames).toEqual([{ timeMs: 0, data: 'early-frame' }]);
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

  it('bounds retries by elapsed time when start failures are slow', async () => {
    jest.useFakeTimers();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    let startAttempts = 0;
    const sendCommand = jest.fn(async (method: string) => {
      if (method !== 'Page.startScreencast') return;
      startAttempts += 1;
      if (startAttempts > 1) {
        await new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Not attached to an active page')), 700);
        });
      }
    });
    const session = {
      sendCommand,
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const recording = await startScreencastOnLighthouseSession(session);
    handlers.get('Page.frameNavigated')?.({ frame: { url: 'https://example.com' } });
    await jest.advanceTimersByTimeAsync(SUBSCRIBE_RETRY_WINDOW_MS + 1000);

    expect(startAttempts).toBe(5);
    expect(warn).toHaveBeenCalledTimes(1);
    await recording.stop();
  });

  it('stops without waiting for an in-flight retry and cleans up when it settles', async () => {
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
    const lateFrameHandler = handlers.get('Page.screencastFrame');
    await Promise.resolve();
    await recording.stop();
    expect(sendCommand.mock.calls.filter(([method]) => method === 'Page.stopScreencast'))
      .toHaveLength(1);

    resolveRetry?.();
    await Promise.resolve();
    await Promise.resolve();
    lateFrameHandler?.({
      data: 'late-frame',
      sessionId: 2,
      metadata: { timestamp: Date.now() / 1000 },
    });

    expect(recording.frames).toEqual([]);
    expect(sendCommand.mock.calls.filter(([method]) => method === 'Page.stopScreencast'))
      .toHaveLength(2);
  });
});
