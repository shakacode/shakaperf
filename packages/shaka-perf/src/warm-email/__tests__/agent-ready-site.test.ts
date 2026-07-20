/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { fetchSiteAccessSignals } from '../agent-ready-site';

function response(url: string, status: number, body = '', headers: Record<string, string> = {}): Response {
  const result = new Response(body, { status, headers });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

function fetchedUrls(fetchSpy: jest.SpyInstance): string[] {
  return fetchSpy.mock.calls.map(([input]) => String(input));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchSiteAccessSignals', () => {
  it('follows public redirects manually for agent-readiness files', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      switch (String(input)) {
        case 'https://example.com/robots.txt':
          return response('https://example.com/robots.txt', 302, '', { location: '/crawler-rules.txt' });
        case 'https://example.com/crawler-rules.txt':
          return response('https://example.com/crawler-rules.txt', 200, 'User-agent: *\nDisallow: /');
        case 'https://example.com/llms.txt':
          return response('https://example.com/llms.txt', 404);
        case 'https://example.com/sitemap.xml':
          return response('https://example.com/sitemap.xml', 200, '<urlset/>');
        default:
          throw new Error(`Unexpected URL: ${String(input)}`);
      }
    });

    await expect(fetchSiteAccessSignals('https://example.com/store')).resolves.toMatchObject({
      robots: { fetched: true, blocksAll: true },
      sitemap: true,
      llmsTxt: false,
      llmsTxtConfirmedAbsent: true,
    });
    expect(fetchedUrls(fetchSpy)).toEqual(expect.arrayContaining([
      'https://example.com/robots.txt',
      'https://example.com/crawler-rules.txt',
      'https://example.com/llms.txt',
      'https://example.com/sitemap.xml',
    ]));
    for (const [, options] of fetchSpy.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ redirect: 'manual' }));
    }
  });

  it('does not fetch a private redirect target for agent-readiness files', async () => {
    const internalUrl = 'http://169.254.169.254/latest/meta-data/';
    const redirectResponse = response('https://example.com/robots.txt', 302, '', { location: internalUrl });
    const cancelSpy = jest.spyOn(redirectResponse.body!, 'cancel');
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      switch (String(input)) {
        case 'https://example.com/robots.txt':
          return redirectResponse;
        case 'https://example.com/llms.txt':
        case 'https://example.com/sitemap.xml':
          return response(String(input), 404);
        default:
          throw new Error(`Unexpected URL: ${String(input)}`);
      }
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(fetchSiteAccessSignals('https://example.com')).resolves.toMatchObject({
      robots: { fetched: false, blocksAll: false },
      sitemap: false,
      llmsTxt: false,
      llmsTxtConfirmedAbsent: true,
    });
    expect(fetchedUrls(fetchSpy)).not.toContain(internalUrl);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a missing Location header', undefined],
    ['a malformed Location header', 'http://[::1'],
    ['a non-http Location header', 'ftp://example.com/robots.txt'],
  ])('rejects %s without following it', async (_label, location) => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://example.com/robots.txt') {
        return response(url, 302, '', location ? { location } : {});
      }
      if (url === 'https://example.com/llms.txt' || url === 'https://example.com/sitemap.xml') {
        return response(url, 404);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(fetchSiteAccessSignals('https://example.com')).resolves.toMatchObject({
      robots: { fetched: false },
      sitemap: false,
      llmsTxt: false,
    });
    if (location) expect(fetchedUrls(fetchSpy)).not.toContain(location);
  });

  it('stops following agent-readiness redirects after five hops', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://example.com/robots.txt') {
        return response(url, 302, '', { location: '/robots-hop-1' });
      }
      const hop = url.match(/^https:\/\/example\.com\/robots-hop-(\d)$/)?.[1];
      if (hop) return response(url, 302, '', { location: `/robots-hop-${Number(hop) + 1}` });
      if (url === 'https://example.com/llms.txt' || url === 'https://example.com/sitemap.xml') {
        return response(url, 404);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(fetchSiteAccessSignals('https://example.com')).resolves.toMatchObject({
      robots: { fetched: false },
      sitemap: false,
    });
    const urls = fetchedUrls(fetchSpy);
    expect(urls).toHaveLength(8);
    expect(urls).toEqual(expect.arrayContaining([
      'https://example.com/robots.txt',
      'https://example.com/robots-hop-1',
      'https://example.com/robots-hop-2',
      'https://example.com/robots-hop-3',
      'https://example.com/robots-hop-4',
      'https://example.com/robots-hop-5',
      'https://example.com/llms.txt',
      'https://example.com/sitemap.xml',
    ]));
    expect(urls).not.toContain('https://example.com/robots-hop-6');
  });
});
