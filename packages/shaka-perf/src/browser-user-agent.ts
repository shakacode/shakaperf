/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * Viewport identities used by Lighthouse emulation and real-Chrome audit
 * stages. The Chrome major is rewritten to match the launched browser.
 */
export const REAL_CHROME_MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export const REAL_CHROME_DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function realChromeUserAgentForFormFactor(formFactor: string): string {
  return formFactor === 'mobile'
    ? REAL_CHROME_MOBILE_USER_AGENT
    : REAL_CHROME_DESKTOP_USER_AGENT;
}

export function matchRealChromeUserAgentVersion(
  userAgent: string,
  browserVersion?: string,
): string {
  const major = browserVersion ? /^(\d+)\./.exec(browserVersion)?.[1] : undefined;
  return major ? userAgent.replace(/Chrome\/\d+\./, `Chrome/${major}.`) : userAgent;
}

export function chromeVersionFromProductString(product: string): string | undefined {
  return /\b(?:Google Chrome|Chromium|Chrome)\b[^\d]*(\d+\.\d+\.\d+\.\d+)\b/
    .exec(product)?.[1];
}
