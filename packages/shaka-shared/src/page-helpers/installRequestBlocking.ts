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
const REGEX_PATTERN_RE = /^\/(.*)\/([a-z]*)$/i;

/**
 * Validate a user-supplied pattern using the historical matching rules.
 *
 * Patterns are matched as case-insensitive substrings by default (so
 * `'/recaptcha/'` blocks every reCAPTCHA resource regardless of host or query
 * string). Wrap a pattern in slashes — `'/foo.*bar/i'` — to opt into a full
 * regular expression instead. CDP blocking cannot represent every regex
 * feature; unsupported regex features warn before being approximated.
 */
function compilePattern(pattern: string): RegExp {
  const re = REGEX_PATTERN_RE.exec(pattern);
  if (re) {
    return new RegExp(re[1], re[2]);
  }
  // Plain string → escape regex metachars and match as a substring.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

function hasUnsupportedRegexFeatures(body: string): boolean {
  return /[.+?${}()|[\]\\]/.test(
    body
      .replace(/\\[./-]/g, '')
      .replace(/\.\*/g, '')
      .replace(/\.\+/g, '')
      .replace(/[\^$]/g, ''),
  );
}

function toBlockedUrlPattern(pattern: string): string {
  const re = REGEX_PATTERN_RE.exec(pattern);
  let body = re ? re[1] : pattern;
  const warnsAboutApproximation = re && hasUnsupportedRegexFeatures(body);

  body = body
    .replace(/\\([./-])/g, '$1')
    .replace(/\.\*/g, '*')
    .replace(/\.\+/g, '*')
    .replace(/[\^$]/g, '')
    .replace(/\*+/g, '*');

  if (warnsAboutApproximation) {
    console.warn(
      `${LOG_PREFIX} CDP request blocking cannot represent full regex semantics; ` +
      `pattern ${pattern} will be approximated as ${body}.`,
    );
  }

  if (!body.startsWith('*')) body = `*${body}`;
  if (!body.endsWith('*')) body = `${body}*`;
  return body;
}

function isBrowserContext(
  target: Page | BrowserContext,
): target is BrowserContext {
  return (
    typeof (target as BrowserContext).pages === 'function' &&
    !('goto' in target)
  );
}

async function blockOnPage(
  context: BrowserContext,
  page: Page,
  urls: string[],
): Promise<void> {
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setBlockedURLs', { urls });
}

/**
 * Block requests whose URL matches one of `patterns`, installed on a Playwright
 * `Page` or `BrowserContext`.
 *
 * Prefer passing a `BrowserContext`: blocking applies to every current page and
 * every page opened later in the context.
 *
 * MUST be called before navigation. The requests this is meant to kill (e.g. a
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

  const urls = patterns.map((pattern) => {
    compilePattern(pattern);
    return toBlockedUrlPattern(pattern);
  });

  if (isBrowserContext(target)) {
    const context = target;
    await Promise.all(context.pages().map((page) => blockOnPage(context, page, urls)));
    context.on('page', (page) => {
      void blockOnPage(context, page, urls).catch((error: unknown) => {
        console.warn(
          `${LOG_PREFIX} failed to install blocking on a new page: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    });
  } else {
    await blockOnPage(target.context(), target, urls);
  }

  console.log(
    chalk.dim(`${LOG_PREFIX} blocking ${patterns.length} URL pattern(s): ${patterns.join(', ')}`),
  );
}
