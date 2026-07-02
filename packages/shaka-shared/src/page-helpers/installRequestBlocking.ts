/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import type { BrowserContext, Page } from 'playwright-core';

const LOG_PREFIX = '[installRequestBlocking]';

/**
 * Compile a user-supplied pattern into a matcher against a request URL.
 *
 * Patterns are matched as case-insensitive substrings by default (so
 * `'/recaptcha/'` blocks every reCAPTCHA resource regardless of host or query
 * string). Wrap a pattern in slashes — `'/foo.*bar/i'` — to opt into a full
 * regular expression instead.
 */
function compilePattern(pattern: string): RegExp {
  const re = /^\/(.*)\/([a-z]*)$/i.exec(pattern);
  if (re) {
    return new RegExp(re[1], re[2]);
  }
  // Plain string → escape regex metachars and match as a substring.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

/**
 * Abort any request whose URL matches one of `patterns`, installed on a
 * Playwright `Page` or `BrowserContext`.
 *
 * Prefer passing a `BrowserContext`: a context-level route applies to every
 * page AND every (possibly nested) iframe in the context, which matters for
 * third-party widgets like reCAPTCHA that load their `anchor`/`bframe` frames
 * from a separate origin. A page-level route can miss those subframes.
 *
 * MUST be called before navigation. `route()` only affects requests that start
 * after it is installed, and the requests this is meant to kill (e.g. a
 * sandboxed reCAPTCHA load that never connects, leaving `networkidle`
 * permanently unsatisfied) can fire during the very first navigation.
 *
 * No-op when `patterns` is empty so callers can pass config straight through.
 */
export async function installRequestBlocking(
  target: Page | BrowserContext,
  patterns: readonly string[] | undefined,
): Promise<void> {
  if (!patterns || patterns.length === 0) return;

  const matchers = patterns.map(compilePattern);
  const matches = (url: string): boolean => matchers.some((m) => m.test(url));

  await target.route(
    (url) => matches(url.href),
    (route) => route.abort(),
  );

  console.log(
    chalk.dim(`${LOG_PREFIX} blocking ${patterns.length} URL pattern(s): ${patterns.join(', ')}`),
  );
}
