/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export const dashSafe = (text: string): string => text.replace(/\s*[—–]\s*/g, ' - ');

export function liveUrlFor(siteUrl: string, startingPath: string): string | undefined {
  return siteUrl && startingPath ? `${siteUrl.replace(/\/$/, '')}${startingPath}` : undefined;
}

export const stripTags = (text: string): string => text.replace(/<[^>]+>/g, '');
