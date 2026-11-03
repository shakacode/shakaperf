/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { realChromeUsesNativeIdentity } from './audit/real-chrome';
import {
  deviceClassOf,
  matchUserAgentChromeVersion,
  userAgentForViewport,
  type IdentityViewport,
} from './browser-user-agent';

export type { IdentityViewport };

/**
 * The user agent a browser should send for this viewport: the viewport's own
 * `userAgent` verbatim, else the device default with the Chrome major matched
 * to `browserVersion`. `undefined` means "leave the browser's native identity
 * alone", which only a headed real-Chrome desktop context asks for (that is
 * the path that has to look like the operator's own browser to a bot wall).
 */
export function viewportUserAgent(
  viewport: IdentityViewport,
  browserVersion?: string,
  usesChromium = true,
): string | undefined {
  // Another engine (Firefox, WebKit) keeps its own identity: a Chrome UA on a
  // non-Chrome engine is a lie the client hints would expose.
  if (!usesChromium) return undefined;
  if (realChromeUsesNativeIdentity(viewport.formFactor)) return undefined;
  if (viewport.userAgent) return viewport.userAgent;
  return matchUserAgentChromeVersion(userAgentForViewport(viewport), browserVersion);
}

/**
 * The identity part of a Playwright `newContext` call for a viewport: user
 * agent plus touch for phones and tablets. Empty when the engine keeps its
 * native identity, so it can always be spread.
 */
export function deviceContextOptions(
  viewport: IdentityViewport,
  browserVersion?: string,
  usesChromium = true,
): { userAgent?: string; hasTouch?: boolean } {
  const userAgent = viewportUserAgent(viewport, browserVersion, usesChromium);
  if (!userAgent) return {};
  return deviceClassOf(viewport) === 'desktop' ? { userAgent } : { userAgent, hasTouch: true };
}
