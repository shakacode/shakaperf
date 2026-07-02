/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Did a navigation land on a bot-protection / challenge interstitial (Cloudflare
// "Just a moment" / Turnstile, Akamai, PerimeterX) instead of the real page?
// Stages flag a scan with this so the client report never presents challenge-page
// data (its violations, score, or DOM) as the site's own. Pure + unit-tested.

// Near-unique challenge markers - safe to match anywhere in the markup.
const STRONG_MARKERS = [
  'cf-browser-verification',
  '/cdn-cgi/challenge-platform',
  '__cf_chl',
  'px-captcha',
  'enable javascript and cookies to continue',
];
// Generic phrases that also appear in legitimate page copy (a contact-form
// captcha, a "403 access denied" widget) - trust them ONLY as the document title
// (a challenge page's whole title), never deep in the body, to avoid false flags.
const TITLE_MARKERS = ['just a moment', 'attention required', 'verify you are human', 'access denied'];

export interface BotWallInput {
  // HTTP status of a raw fetch, when known. Browser navigations don't expose one.
  status?: number;
  // The page <head>/<html> markup (a slice is enough) and/or the document title.
  html?: string | null;
  title?: string | null;
}

export function looksLikeBotWall({ status, html, title }: BotWallInput = {}): boolean {
  if (status !== undefined && (status === 401 || status === 403 || status === 429 || status === 503)) return true;
  const t = (title ?? '').toLowerCase();
  if (TITLE_MARKERS.some((m) => t.includes(m))) return true;
  const hay = `${t}\n${(html ?? '').slice(0, 4000)}`.toLowerCase();
  return STRONG_MARKERS.some((m) => hay.includes(m));
}

// A challenge is single-screen: a marker on a page far taller than the viewport
// is a real page with a lingering token, not a wall (status/title stay decisive).
export function scanLandedOnBotWall(input: BotWallInput, capturedHeightPx?: number, viewportHeightPx?: number): boolean {
  if (!looksLikeBotWall(input)) return false;
  if (looksLikeBotWall({ status: input.status, title: input.title })) return true;
  if (capturedHeightPx && viewportHeightPx && capturedHeightPx > viewportHeightPx * 2) return false;
  return true;
}
