/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import { screencastRecorder } from '../screencast-recorder';

describe('screencastRecorder', () => {
  afterEach(async () => {
    await screencastRecorder.stop();
    jest.useRealTimers();
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

    screencastRecorder.record(true);
    await screencastRecorder.onNavigate(session);
    expect(startAttempts).toBe(1);

    handlers.get('Page.frameNavigated')?.({ frame: { url: 'https://example.com' } });
    await jest.advanceTimersByTimeAsync(500);

    expect(startAttempts).toBe(4);
    expect(sendCommand).toHaveBeenLastCalledWith('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 500,
      maxHeight: 4096,
      everyNthFrame: 1,
    });
  });
});
