/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { installRequestBlocking } from '../page-helpers/installRequestBlocking';

describe('installRequestBlocking', () => {
  let consoleLog: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });

  it('blocks existing and future context pages through CDP', async () => {
    const firstPage = {};
    const secondPage = {};
    const firstSession = {
      send: jest.fn(async () => {}),
    };
    const secondSession = {
      send: jest.fn(async () => {}),
    };
    const context = {
      pages: jest.fn(() => [firstPage]),
      newCDPSession: jest
        .fn()
        .mockResolvedValueOnce(firstSession)
        .mockResolvedValueOnce(secondSession),
      on: jest.fn(),
      route: jest.fn(),
    };

    await installRequestBlocking(context as never, ['/recaptcha/']);

    expect(context.route).not.toHaveBeenCalled();
    expect(context.newCDPSession).toHaveBeenCalledWith(firstPage);
    expect(firstSession.send).toHaveBeenNthCalledWith(1, 'Network.enable');
    expect(firstSession.send).toHaveBeenNthCalledWith(2, 'Network.setBlockedURLs', {
      urls: ['*recaptcha*'],
    });

    const pageHandler = context.on.mock.calls.find(([event]) => event === 'page')?.[1];
    expect(pageHandler).toBeDefined();
    pageHandler(secondPage);
    await new Promise((resolve) => setImmediate(resolve));

    expect(context.newCDPSession).toHaveBeenCalledWith(secondPage);
    expect(secondSession.send).toHaveBeenNthCalledWith(1, 'Network.enable');
    expect(secondSession.send).toHaveBeenNthCalledWith(2, 'Network.setBlockedURLs', {
      urls: ['*recaptcha*'],
    });
  });

  it('blocks a page through its context CDP session', async () => {
    const page = {
      goto: jest.fn(),
      context: jest.fn(),
      route: jest.fn(),
    };
    const session = {
      send: jest.fn(async () => {}),
    };
    const context = {
      newCDPSession: jest.fn(async () => session),
    };
    page.context.mockReturnValue(context);

    await installRequestBlocking(page as never, ['google.com']);

    expect(page.route).not.toHaveBeenCalled();
    expect(context.newCDPSession).toHaveBeenCalledWith(page);
    expect(session.send).toHaveBeenNthCalledWith(1, 'Network.enable');
    expect(session.send).toHaveBeenNthCalledWith(2, 'Network.setBlockedURLs', {
      urls: ['*google.com*'],
    });
  });

  it('warns when a regex pattern needs CDP approximation', async () => {
    const page = {
      goto: jest.fn(),
      context: jest.fn(),
    };
    const session = {
      send: jest.fn(async () => {}),
    };
    const context = {
      newCDPSession: jest.fn(async () => session),
    };
    page.context.mockReturnValue(context);

    await installRequestBlocking(page as never, ['/foo|bar/i']);

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('CDP request blocking cannot represent full regex semantics'),
    );
    expect(session.send).toHaveBeenNthCalledWith(2, 'Network.setBlockedURLs', {
      urls: ['*foo|bar*'],
    });
  });

  it('does not warn for simple escaped regex literals CDP can represent', async () => {
    const page = {
      goto: jest.fn(),
      context: jest.fn(),
    };
    const session = {
      send: jest.fn(async () => {}),
    };
    const context = {
      newCDPSession: jest.fn(async () => session),
    };
    page.context.mockReturnValue(context);

    await installRequestBlocking(page as never, ['/google\\.com/']);

    expect(consoleWarn).not.toHaveBeenCalled();
    expect(session.send).toHaveBeenNthCalledWith(2, 'Network.setBlockedURLs', {
      urls: ['*google.com*'],
    });
  });
});
