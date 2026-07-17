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
  faviconMimeFromBytes,
  faviconTextPrefix,
  isPublicHost,
  parseIconHref,
} from '../site-assets';

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

describe('faviconMimeFromBytes', () => {
  it('identifies every binary icon signature before considering response metadata', () => {
    expect(faviconMimeFromBytes(new Uint8Array([0x00, 0x00, 0x01, 0x00]))).toBe('image/x-icon');
    expect(faviconMimeFromBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(faviconMimeFromBytes(new Uint8Array([0x47, 0x49, 0x46]))).toBe('image/gif');
    expect(faviconMimeFromBytes(new Uint8Array([0xff, 0xd8]))).toBe('image/jpeg');
  });
});

describe('faviconTextPrefix', () => {
  it('decodes only the bounded prefix used for text and SVG validation', () => {
    const bytes = new TextEncoder().encode(`${'a'.repeat(8192)}b`);
    expect(faviconTextPrefix(bytes)).toBe('a'.repeat(8192));
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

describe('isPublicHost', () => {
  it('accepts public hostnames and public IPs', () => {
    for (const h of ['example.com', 'www.sunhub.com', '8.8.8.8', '1.2.3.4', 'fcbarcelona.com']) {
      expect(isPublicHost(h)).toBe(true);
    }
  });

  it('rejects loopback, private, CGNAT, link-local and metadata addresses', () => {
    for (const h of [
      'localhost',
      'foo.localhost',
      '127.0.0.1',
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '100.64.0.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      '[::1]',
      'fc00::1',
      'fd12::1',
      'fe80::1',
    ]) {
      expect(isPublicHost(h)).toBe(false);
    }
  });

  it('does not reject a public 172.x outside the private block', () => {
    expect(isPublicHost('172.15.0.1')).toBe(true);
    expect(isPublicHost('172.32.0.1')).toBe(true);
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
