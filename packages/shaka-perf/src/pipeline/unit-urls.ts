/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export function resolveUrl(pathOrUrl: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const parsed = new URL(pathOrUrl, base);
  for (const [key, value] of base.searchParams) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value);
  }
  return parsed.href;
}
