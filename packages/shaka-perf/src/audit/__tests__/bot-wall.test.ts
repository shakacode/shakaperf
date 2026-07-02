/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { looksLikeBotWall, scanLandedOnBotWall } from '../bot-wall';

describe('looksLikeBotWall', () => {
  it('flags blocking HTTP statuses', () => {
    expect(looksLikeBotWall({ status: 403 })).toBe(true);
    expect(looksLikeBotWall({ status: 429 })).toBe(true);
    expect(looksLikeBotWall({ status: 503 })).toBe(true);
    expect(looksLikeBotWall({ status: 200 })).toBe(false);
  });

  it('flags a Cloudflare "Just a moment" interstitial by title', () => {
    expect(looksLikeBotWall({ title: 'Just a moment...' })).toBe(true);
  });

  it('flags a Turnstile / branded challenge by markup', () => {
    const html = '<head><title>Genius</title></head><body>Verify you are human ... /cdn-cgi/challenge-platform __cf_chl';
    expect(looksLikeBotWall({ title: 'Genius', html })).toBe(true);
  });

  it('does not flag a normal page', () => {
    expect(looksLikeBotWall({ status: 200, title: 'Genius | Song Lyrics & Knowledge', html: '<main>real content</main>' })).toBe(false);
  });

  it('is case-insensitive and tolerates null inputs', () => {
    expect(looksLikeBotWall({ title: 'JUST A MOMENT...' })).toBe(true);
    expect(looksLikeBotWall({ html: null, title: null })).toBe(false);
  });
});

describe('scanLandedOnBotWall', () => {
  // Body-only token + real title: the lingering-token case the height guard rescues.
  const bodyTokenHtml = '<head><title>Genius</title></head><body>real content /cdn-cgi/challenge-platform __cf_chl';
  const PHONE = 823;

  it('flags a short single-screen challenge interstitial', () => {
    expect(scanLandedOnBotWall({ title: 'Just a moment...', html: bodyTokenHtml }, PHONE, PHONE)).toBe(true);
  });

  it('keeps a decisive challenge TITLE or status blocked even on a tall page', () => {
    expect(scanLandedOnBotWall({ title: 'Just a moment...' }, 9000, PHONE)).toBe(true);
    expect(scanLandedOnBotWall({ status: 403 }, 9000, PHONE)).toBe(true);
  });

  it('clears a really-measured tall page when only a body token lingers', () => {
    // genius via real-Chrome: 6183px real page, __cf_chl still in outerHTML.
    expect(scanLandedOnBotWall({ title: 'Genius', html: bodyTokenHtml }, 6183, PHONE)).toBe(false);
  });

  it('treats exactly 2x viewport as blocked, just over 2x as cleared', () => {
    expect(scanLandedOnBotWall({ title: 'Genius', html: bodyTokenHtml }, PHONE * 2, PHONE)).toBe(true);
    expect(scanLandedOnBotWall({ title: 'Genius', html: bodyTokenHtml }, PHONE * 2 + 1, PHONE)).toBe(false);
  });

  it('falls back to the marker when height is missing or zero', () => {
    expect(scanLandedOnBotWall({ title: 'Genius', html: bodyTokenHtml })).toBe(true);
    expect(scanLandedOnBotWall({ title: 'Genius', html: bodyTokenHtml }, 0, PHONE)).toBe(true);
    expect(scanLandedOnBotWall({ title: 'Genius', html: bodyTokenHtml }, undefined, PHONE)).toBe(true);
  });

  it('never flags a page that has no challenge marker at all', () => {
    expect(scanLandedOnBotWall({ title: 'Genius | Song Lyrics & Knowledge', html: '<main>real</main>' }, PHONE, PHONE)).toBe(false);
  });
});
