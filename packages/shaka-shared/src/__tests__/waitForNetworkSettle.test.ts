/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { EventEmitter } from 'node:events';

import { installNetworkTracking, waitForNetworkSettle } from '../page-helpers/waitForNetworkSettle';

/** `pageQuietMs` stands in for the in-page read: 0 while loading or busy. */
function fakePage(pageQuietMs: () => number) {
  const events = new EventEmitter();
  const context = new EventEmitter();
  return {
    context,
    events,
    page: {
      context: () => context,
      waitForLoadState: jest.fn(async () => {}),
      url: () => 'http://example.test/menu',
      on: (event: string, fn: (...args: unknown[]) => void) => events.on(event, fn),
      off: (event: string, fn: (...args: unknown[]) => void) => events.off(event, fn),
      evaluate: jest.fn(async () => pageQuietMs()),
    },
  };
}

async function msUntilSettled(promise: Promise<void>): Promise<number> {
  const started = Date.now();
  let settledAt = -1;
  void promise.then(() => {
    settledAt = Date.now() - started;
  });
  for (let i = 0; i < 200 && settledAt < 0; i++) await jest.advanceTimersByTimeAsync(50);
  await promise;
  return settledAt;
}

describe('waitForNetworkSettle', () => {
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleLog.mockRestore();
  });

  it('waits while the page reports activity Playwright never saw (loading, resources, long tasks)', async () => {
    const busyUntil = Date.now() + 3_000;
    const { page } = fakePage(() => (Date.now() < busyUntil ? 0 : 10_000));

    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeGreaterThanOrEqual(3_000);
  });

  it('waits for a request Playwright saw start to finish, then a quiet window', async () => {
    const { page, events } = fakePage(() => 10_000);
    const request = { url: () => 'http://example.test/menu.json' };
    setTimeout(() => events.emit('request', request), 100);
    setTimeout(() => events.emit('requestfinished', request), 2_000);

    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeGreaterThanOrEqual(2_500);
  });

  it('ignores finish events for requests that started before it subscribed', async () => {
    const { page, events } = fakePage(() => 10_000);
    setTimeout(() => events.emit('requestfinished', { url: () => 'http://example.test/menu.json' }), 100);

    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeLessThan(1_000);
  });

  it('waits for the initial networkidle state without pre-navigation tracking', async () => {
    const { page } = fakePage(() => 10_000);
    page.waitForLoadState.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 2_000)));

    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeGreaterThanOrEqual(2_000);
  });

  it.each(['requestfinished', 'requestfailed'])('waits for an earlier request through %s and a quiet window', async (endEvent) => {
    const { page, context } = fakePage(() => 10_000);
    installNetworkTracking(context as never);
    installNetworkTracking(context as never);
    expect(context.listenerCount('request')).toBe(1);
    const request = { frame: () => ({ page: () => page }), serviceWorker: () => null, url: () => 'http://example.test/menu.json' };
    context.emit('request', request);
    setTimeout(() => context.emit(endEvent, request), 2_000);

    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeGreaterThanOrEqual(2_500);
    expect(page.waitForLoadState).not.toHaveBeenCalled();
    // A second wait must retain tracking even after the first one resolved.
    context.emit('request', request);
    setTimeout(() => context.emit(endEvent, request), 2_000);
    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeGreaterThanOrEqual(2_500);
    context.emit('close');
    expect(context.listenerCount('request')).toBe(0);
  });

  it('ignores a blob: request that never finishes, such as a terminated Worker script', async () => {
    const { page, events } = fakePage(() => 10_000);
    setTimeout(() => events.emit('request', { url: () => 'blob:http://example.test/1234' }), 100);

    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeLessThan(1_000);
  });

  it('treats a navigation mid-read as activity and keeps polling', async () => {
    let calls = 0;
    const { page } = fakePage(() => {
      calls += 1;
      if (calls === 1) throw new Error('Execution context was destroyed, most likely because of a navigation');
      return 10_000;
    });

    await msUntilSettled(waitForNetworkSettle(page as never));

    expect(calls).toBeGreaterThan(1);
  });

  it('throws after the timeout when the page never settles', async () => {
    const { page } = fakePage(() => 0);

    const result = waitForNetworkSettle(page as never, { timeout: 1_000 });
    const assertion = expect(result).rejects.toThrow(
      '[waitForNetworkSettle] timed out after 1000 ms for http://example.test/menu',
    );
    await jest.advanceTimersByTimeAsync(1_500);
    await assertion;
  });

  it('times out even if the in-page read never returns', async () => {
    const { page } = fakePage(() => 0);
    page.evaluate.mockImplementation(() => new Promise(() => {}));

    const result = waitForNetworkSettle(page as never, { timeout: 1_000 });
    const assertion = expect(result).rejects.toThrow('timed out after 1000 ms');
    await jest.advanceTimersByTimeAsync(1_500);
    await assertion;
  });

  it('removes its listeners when done', async () => {
    const { page, events } = fakePage(() => 10_000);

    await msUntilSettled(waitForNetworkSettle(page as never));

    for (const event of ['request', 'requestfinished', 'requestfailed']) {
      expect(events.listenerCount(event)).toBe(0);
    }
  });
});
