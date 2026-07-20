/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  faviconDataUri,
  faviconLinkTag,
  fetchSiteFavicon,
  parseIconHref,
} from '../site-assets';

function response(url: string, status: number, body: string | Uint8Array = '', headers: Record<string, string> = {}): Response {
  const result = new Response(body as unknown as BodyInit, { status, headers });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

function fetchedUrls(fetchSpy: jest.SpyInstance): string[] {
  return fetchSpy.mock.calls.map(([input]) => String(input));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('faviconDataUri', () => {
  it('uses an image content-type as a fallback when no known icon signature is present', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(faviconDataUri(bytes, 'image/png')).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
  });

  it('strips content-type parameters and lowercases the mime', () => {
    const bytes = new Uint8Array([9]);
    expect(faviconDataUri(bytes, 'image/X-Icon; charset=binary')).toBe(
      `data:image/x-icon;base64,${Buffer.from(bytes).toString('base64')}`,
    );
  });

  it('rejects an HTML response instead of embedding it as an icon', () => {
    const html = new TextEncoder().encode('<!doctype html><title>Not an icon</title>');
    expect(faviconDataUri(html, 'text/html')).toBeNull();
  });

  it('rejects recognizable HTML and JSON bodies even when the response claims to be an image', () => {
    const html = new TextEncoder().encode('<!doctype html><title>Not an icon</title>');
    const json = new TextEncoder().encode('{"error":"not found"}');
    expect(faviconDataUri(html, 'image/png')).toBeNull();
    expect(faviconDataUri(json, 'image/png')).toBeNull();
  });

  it('rejects a plain-text error body even when the response claims to be an image', () => {
    const text = new TextEncoder().encode('Not Found');
    expect(faviconDataUri(text, 'image/png')).toBeNull();
  });

  it('uses ICO and PNG signatures before an incorrect response content-type', () => {
    const ico = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(faviconDataUri(ico, 'image/png')).toBe(`data:image/x-icon;base64,${Buffer.from(ico).toString('base64')}`);
    expect(faviconDataUri(png, 'text/plain')).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
  });

  it('recognizes GIF and JPEG signatures when the response content-type is wrong', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(faviconDataUri(gif, 'text/plain')).toBe(`data:image/gif;base64,${Buffer.from(gif).toString('base64')}`);
    expect(faviconDataUri(jpeg, 'application/json')).toBe(`data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`);
  });

  it('uses an SVG root element before an incorrect response content-type', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(faviconDataUri(svg, 'text/plain')).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
    expect(faviconDataUri(new TextEncoder().encode('<html/>'), 'image/svg+xml')).toBeNull();
  });

  it('recognizes an SVG root after valid XML prefixes without accepting a similarly named tag', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?><!-- icon --><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(faviconDataUri(svg, 'text/plain')).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
    expect(faviconDataUri(new TextEncoder().encode('<svg-not-an-icon/>'), 'image/png')).toBeNull();
  });

  it('rejects a long sequence of SVG-like comments without expensive backtracking', () => {
    const body = new TextEncoder().encode('<!-- -->'.repeat(24) + 'X');
    const started = performance.now();
    expect(faviconDataUri(body, 'image/svg+xml')).toBeNull();
    expect(performance.now() - started).toBeLessThan(80);
  });

  it('rejects empty bytes and files too large to inline (cap is inclusive)', () => {
    expect(faviconDataUri(new Uint8Array(0), 'image/x-icon')).toBeNull();
    expect(faviconDataUri(new Uint8Array(512 * 1024 + 1), 'image/x-icon')).toBeNull();
    expect(faviconDataUri(new Uint8Array(512 * 1024), 'image/png')).not.toBeNull();
  });

  it('rejects a content-type that could break out of the href attribute', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    // Attacker-controlled header with a quote + tag: must NOT reach the data URI.
    const hostile = 'image/svg+xml"><script>alert(1)</script>';
    expect(faviconDataUri(bytes, hostile)).toBeNull();
  });
});

describe('faviconLinkTag', () => {
  it('emits the inlined favicon when we have one', () => {
    expect(faviconLinkTag('data:image/x-icon;base64,AAAA')).toBe(
      '<link rel="icon" href="data:image/x-icon;base64,AAAA" />',
    );
  });

  it('omits the icon link when no usable favicon was fetched', () => {
    expect(faviconLinkTag(null)).toBe('');
  });

  it('escapes any HTML-special char that reaches the href (defense in depth)', () => {
    expect(faviconLinkTag('data:image/x-icon;base64,"><script>')).not.toContain('"><script>');
  });
});

describe('parseIconHref', () => {
  it('prefers a real icon rel over apple-touch-icon and mask-icon', () => {
    const html =
      '<link rel="apple-touch-icon" href="/apple.png">' +
      '<link rel="mask-icon" href="/mask.svg">' +
      '<link rel="icon" href="/real.ico">';
    expect(parseIconHref(html)).toBe('/real.ico');
  });

  it('matches "shortcut icon" and tolerates href before rel', () => {
    expect(parseIconHref('<link href="/f.ico" rel="shortcut icon">')).toBe('/f.ico');
  });

  it('returns null when no icon link is present', () => {
    expect(parseIconHref('<link rel="stylesheet" href="/x.css"><meta charset="utf-8">')).toBeNull();
  });

  it('does not catastrophically backtrack on a hostile body', () => {
    // A 300KB run of unterminated icon-like text used to hang the old regex.
    const hostile = '<link rel="' + '"icon"'.repeat(50_000);
    expect(parseIconHref(hostile)).toBeNull();
  });
});

describe('fetchSiteFavicon', () => {
  it('keeps the successful non-redirect favicon path', async () => {
    const icon = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      response('https://example.com/favicon.ico', 200, icon, { 'content-type': 'image/png' }),
    );

    await expect(fetchSiteFavicon('https://example.com/products')).resolves.toBe(
      `data:image/png;base64,${Buffer.from(icon).toString('base64')}`,
    );
    expect(fetchedUrls(fetchSpy)).toEqual(['https://example.com/favicon.ico']);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/favicon.ico',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('follows a public redirect manually and resolves a relative icon URL against the final page URL', async () => {
    const icon = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      switch (String(input)) {
        case 'https://example.com/favicon.ico':
          return response('https://example.com/favicon.ico', 200, 'not an icon', { 'content-type': 'text/plain' });
        case 'https://example.com/':
          return response('https://example.com/', 302, '', { location: 'https://www.example.com/app/' });
        case 'https://www.example.com/app/':
          return response('https://www.example.com/app/', 200, '<link rel="icon" href="icons/favicon.png">', { 'content-type': 'text/html' });
        case 'https://www.example.com/app/icons/favicon.png':
          return response('https://www.example.com/app/icons/favicon.png', 200, icon, { 'content-type': 'image/png' });
        default:
          throw new Error(`Unexpected URL: ${String(input)}`);
      }
    });

    await expect(fetchSiteFavicon('https://example.com/products')).resolves.toBe(
      `data:image/png;base64,${Buffer.from(icon).toString('base64')}`,
    );
    expect(fetchedUrls(fetchSpy)).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/',
      'https://www.example.com/app/',
      'https://www.example.com/app/icons/favicon.png',
    ]);
    for (const [, options] of fetchSpy.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ redirect: 'manual' }));
    }
  });

  it('does not fetch a private redirect target', async () => {
    const internalUrl = 'http://169.254.169.254/latest/meta-data/';
    const redirectResponse = response('https://example.com/favicon.ico', 302, '', { location: internalUrl });
    const cancelSpy = jest.spyOn(redirectResponse.body!, 'cancel');
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      if (String(input) === 'https://example.com/favicon.ico') {
        return redirectResponse;
      }
      if (String(input) === 'https://example.com/') {
        return response('https://example.com/', 200, 'no icon', { 'content-type': 'text/html' });
      }
      throw new Error(`Unexpected URL: ${String(input)}`);
    });

    await expect(fetchSiteFavicon('https://example.com')).resolves.toBeNull();
    expect(fetchedUrls(fetchSpy)).not.toContain(internalUrl);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a missing Location header', undefined],
    ['a malformed Location header', 'http://[::1'],
    ['a non-http Location header', 'ftp://example.com/favicon.ico'],
  ])('rejects %s without fetching it', async (_label, location) => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      if (String(input) === 'https://example.com/favicon.ico') {
        return response('https://example.com/favicon.ico', 302, '', location ? { location } : {});
      }
      if (String(input) === 'https://example.com/') {
        return response('https://example.com/', 200, 'no icon', { 'content-type': 'text/html' });
      }
      throw new Error(`Unexpected URL: ${String(input)}`);
    });

    await expect(fetchSiteFavicon('https://example.com')).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    if (location) expect(fetchedUrls(fetchSpy)).not.toContain(location);
  });

  it('stops following favicon redirects after five hops', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://example.com/') {
        return response(url, 200, 'no icon', { 'content-type': 'text/html' });
      }
      if (url === 'https://example.com/favicon.ico') {
        return response(url, 302, '', { location: '/hop-1' });
      }
      const hop = url.match(/^https:\/\/example\.com\/hop-(\d)$/)?.[1];
      if (hop) return response(url, 302, '', { location: `/hop-${Number(hop) + 1}` });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(fetchSiteFavicon('https://example.com')).resolves.toBeNull();
    expect(fetchedUrls(fetchSpy)).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/hop-1',
      'https://example.com/hop-2',
      'https://example.com/hop-3',
      'https://example.com/hop-4',
      'https://example.com/hop-5',
      'https://example.com/',
    ]);
  });
});
