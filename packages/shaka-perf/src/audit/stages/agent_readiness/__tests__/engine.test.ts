/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { fetchRawHtml } from '../engine';

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function fetchedUrls(fetchSpy: jest.SpyInstance): string[] {
  return fetchSpy.mock.calls.map(([input]) => String(input));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchRawHtml', () => {
  it('does not fetch a non-public starting host', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(fetchRawHtml('http://127.0.0.1/admin', 1000)).resolves.toEqual({ html: null });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a public non-redirect response', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      response(200, '<main>public HTML</main>', { 'content-type': 'text/html; charset=utf-8' }),
    );

    await expect(fetchRawHtml('https://example.com/start', 1000)).resolves.toEqual({
      html: '<main>public HTML</main>',
      status: 200,
      contentType: 'text/html; charset=utf-8',
      bytes: 24,
    });
    expect(fetchedUrls(fetchSpy)).toEqual(['https://example.com/start']);
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/start', expect.objectContaining({
      redirect: 'manual',
    }));
  });

  it('follows public redirects manually and preserves the final response metadata', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      switch (String(input)) {
        case 'https://example.com/start':
          return response(302, '', { location: '/final' });
        case 'https://example.com/final':
          return response(200, '<main>public HTML</main>', { 'content-type': 'text/html; charset=utf-8' });
        default:
          throw new Error(`Unexpected URL: ${String(input)}`);
      }
    });

    await expect(fetchRawHtml('https://example.com/start', 1000)).resolves.toEqual({
      html: '<main>public HTML</main>',
      status: 200,
      contentType: 'text/html; charset=utf-8',
      bytes: 24,
    });
    expect(fetchedUrls(fetchSpy)).toEqual(['https://example.com/start', 'https://example.com/final']);
    for (const [, options] of fetchSpy.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ redirect: 'manual' }));
    }
  });

  it('does not fetch a non-public redirect target', async () => {
    const internalUrl = 'http://169.254.169.254/latest/meta-data/';
    const redirectResponse = response(302, '', { location: internalUrl });
    const cancelSpy = jest.spyOn(redirectResponse.body!, 'cancel');
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      if (String(input) === 'https://example.com/start') return redirectResponse;
      throw new Error(`Unexpected URL: ${String(input)}`);
    });

    await expect(fetchRawHtml('https://example.com/start', 1000)).resolves.toEqual({ html: null });

    expect(fetchedUrls(fetchSpy)).toEqual(['https://example.com/start']);
    expect(fetchedUrls(fetchSpy)).not.toContain(internalUrl);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a missing Location header', undefined],
    ['a malformed Location header', 'http://[::1'],
    ['a non-http Location header', 'ftp://example.com/final'],
  ])('rejects %s without following it', async (_label, location) => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      if (String(input) === 'https://example.com/start') {
        return response(302, '', location ? { location } : {});
      }
      throw new Error(`Unexpected URL: ${String(input)}`);
    });

    await expect(fetchRawHtml('https://example.com/start', 1000)).resolves.toEqual({ html: null });

    expect(fetchedUrls(fetchSpy)).toEqual(['https://example.com/start']);
  });

  it('stops following redirects after five hops', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://example.com/start') return response(302, '', { location: '/hop-1' });
      const hop = url.match(/^https:\/\/example\.com\/hop-(\d)$/)?.[1];
      if (hop) return response(302, '', { location: `/hop-${Number(hop) + 1}` });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(fetchRawHtml('https://example.com/start', 1000)).resolves.toEqual({ html: null });

    expect(fetchedUrls(fetchSpy)).toEqual([
      'https://example.com/start',
      'https://example.com/hop-1',
      'https://example.com/hop-2',
      'https://example.com/hop-3',
      'https://example.com/hop-4',
      'https://example.com/hop-5',
    ]);
    expect(fetchedUrls(fetchSpy)).not.toContain('https://example.com/hop-6');
  });
});
