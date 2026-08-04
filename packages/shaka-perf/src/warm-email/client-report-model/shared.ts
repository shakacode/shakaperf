/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export const dashSafe = (text: string): string => text.replace(/\s*[—–]\s*/g, ' - ');

export function liveUrlFor(siteUrl: string, startingPath: string): string | undefined {
  if (!siteUrl || !startingPath) return undefined;
  // Resolve `startingPath` as a URL reference. A test may point at an absolute
  // URL on another host, which multi-host sites need - a phone-only m.*
  // subdomain or a storefront on its own domain. Concatenating would emit
  // `https://site.comhttps://m.site.com/...`, so let the absolute path replace
  // the base.
  try {
    return new URL(startingPath, siteUrl).href;
  } catch {
    return `${siteUrl.replace(/\/$/, '')}${startingPath}`;
  }
}

export const stripTags = (text: string): string => text.replace(/<[^>]+>/g, '');
