/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Type-only: this module is bundled into the report shell, which cannot load
// shaka-shared at runtime.
import type { Viewport } from 'shaka-shared';

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

export type IdentityViewport = Pick<Viewport, 'label' | 'formFactor' | 'userAgent'>;

/**
 * The device a viewport identifies as, guessed from its label: `tablet`,
 * `phone` / `mobile`, `desktop` anywhere in the label (so `phone-tall` is a
 * phone). A label that says none of these falls back to `formFactor`: mobile
 * is a phone, desktop a desktop.
 */
export function deviceClassOf(viewport: Pick<IdentityViewport, 'label' | 'formFactor'>): DeviceClass {
  const label = viewport.label.toLowerCase();
  if (label.includes('tablet')) return 'tablet';
  if (label.includes('phone') || label.includes('mobile')) return 'phone';
  if (label.includes('desktop')) return 'desktop';
  return viewport.formFactor === 'mobile' ? 'phone' : 'desktop';
}

/**
 * The identity every engine sends for a viewport's device class: Playwright
 * contexts (visreg, accessibility, agent-readiness), the Lighthouse emulation,
 * and the Chrome launch flag under it. Chrome's own UA for each class, with
 * the major version rewritten to the launched browser where it is known.
 */
export const PHONE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// Chrome on an Android tablet: same platform token, no `Mobile` token.
export const TABLET_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function userAgentForDevice(device: DeviceClass): string {
  switch (device) {
    case 'phone': return PHONE_USER_AGENT;
    case 'tablet': return TABLET_USER_AGENT;
    case 'desktop': return DESKTOP_USER_AGENT;
  }
}

/** A viewport's `userAgent` override, else its device's default. */
export function userAgentForViewport(viewport: IdentityViewport): string {
  return viewport.userAgent ?? userAgentForDevice(deviceClassOf(viewport));
}

/**
 * Rewrites the Chrome major in a default identity to the launched browser's,
 * so the UA does not claim a version the browser's client hints contradict.
 * A viewport's explicit `userAgent` is never rewritten. Returns the template
 * unchanged when the version is unusable.
 */
export function matchUserAgentChromeVersion(userAgent: string, browserVersion?: string): string {
  const major = browserVersion ? /^(\d+)\./.exec(browserVersion)?.[1] : undefined;
  return major ? userAgent.replace(/Chrome\/\d+\./, `Chrome/${major}.`) : userAgent;
}

export function chromeVersionFromProductString(product: string): string | undefined {
  return /\b(?:Google Chrome|Chromium|Chrome)\b[^\d]*(\d+\.\d+\.\d+\.\d+)\b/
    .exec(product)?.[1];
}
