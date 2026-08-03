/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { liveUrlFor } from '../client-report-model/shared';

describe('liveUrlFor', () => {
  it('joins a root-relative starting path onto the site URL', () => {
    expect(liveUrlFor('https://example.com', '/blog/')).toBe('https://example.com/blog/');
  });

  it('does not double the slash when the site URL has a trailing one', () => {
    expect(liveUrlFor('https://example.com/', '/blog/')).toBe('https://example.com/blog/');
  });

  it('lets an absolute starting path replace the base host', () => {
    expect(liveUrlFor('https://example.com', 'https://m.example.com/us/')).toBe('https://m.example.com/us/');
  });

  it('keeps the query string and fragment of an absolute starting path', () => {
    expect(liveUrlFor('https://example.com', 'https://m.example.com/p?variant=2#spec')).toBe(
      'https://m.example.com/p?variant=2#spec',
    );
  });

  it('returns undefined when either side is empty', () => {
    expect(liveUrlFor('', '/blog/')).toBeUndefined();
    expect(liveUrlFor('https://example.com', '')).toBeUndefined();
  });

  it('falls back to concatenation when the site URL is not parseable', () => {
    expect(liveUrlFor('not a url', '/blog/')).toBe('not a url/blog/');
  });
});
