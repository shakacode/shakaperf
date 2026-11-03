/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { EventEmitter } from 'node:events';

import { installNetworkTracking, waitForNetworkSettle } from '../page-helpers/waitForNetworkSettle';

/** `pageQuietMs` stands in for the in-page read: 0 while loading or busy. */
function fakePage(pageQuietMs: () => number, { tracked = true } = {}) {
  const context = new EventEmitter();
  const page = {
    context: () => context,
    url: () => 'http://example.test/menu',
    evaluate: jest.fn(async () => pageQuietMs()),
  };
  const request = (url = 'http://example.test/menu.json') => ({
    frame: () => ({ page: () => page }),
    serviceWorker: () => null,
    url: () => url,
  });
  if (tracked) installNetworkTracking(context as never);
  return { context, page, request };
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

  it('throws when installNetworkTracking was not called on the context', async () => {
    const { page } = fakePage(() => 10_000, { tracked: false });

    await expect(waitForNetworkSettle(page as never)).rejects.toThrow(
      '[waitForNetworkSettle] installNetworkTracking(context) was not called before navigating to http://example.test/menu',
    );
  });

  it('waits for a request that starts during the wait to finish, then a quiet window', async () => {
    const { page, context, request } = fakePage(() => 10_000);
    const r = request();
    setTimeout(() => context.emit('request', r), 100);
    setTimeout(() => context.emit('requestfinished', r), 2_000);

    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeGreaterThanOrEqual(2_500);
  });

  it.each(['requestfinished', 'requestfailed'])('waits for an earlier request through %s and a quiet window', async (endEvent) => {
    const { page, context, request: r } = fakePage(() => 10_000);
    installNetworkTracking(context as never);
    expect(context.listenerCount('request')).toBe(1);
    const request = r();
    context.emit('request', request);
    setTimeout(() => context.emit(endEvent, request), 2_000);

    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeGreaterThanOrEqual(2_500);
    // A second wait must retain tracking even after the first one resolved.
    context.emit('request', request);
    setTimeout(() => context.emit(endEvent, request), 2_000);
    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeGreaterThanOrEqual(2_500);
    context.emit('close');
    expect(context.listenerCount('request')).toBe(0);
  });

  it('ignores a blob: request that never finishes, such as a terminated Worker script', async () => {
    const { page, context, request } = fakePage(() => 10_000);
    setTimeout(() => context.emit('request', request('blob:http://example.test/1234')), 100);

    expect(await msUntilSettled(waitForNetworkSettle(page as never))).toBeLessThan(1_000);
  });

  it('shares installed trackers with another copy of the module in the same process', async () => {
    const { page, context } = fakePage(() => 10_000);
    let otherCopy!: typeof import('../page-helpers/waitForNetworkSettle');
    jest.isolateModules(() => {
      otherCopy = require('../page-helpers/waitForNetworkSettle') as typeof otherCopy;
    });
    expect(otherCopy.waitForNetworkSettle).not.toBe(waitForNetworkSettle);

    await msUntilSettled(otherCopy.waitForNetworkSettle(page as never));

    context.emit('close');
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
});
