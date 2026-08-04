/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext } from 'playwright-core';
import { assertConsoleClean, installConsoleCapture, type BrowserConsolePolicy } from '../browser-console';

const BOTH: BrowserConsolePolicy = { failOn: ['error', 'warn'], allowList: [] };

/** A context armed with `policy` that has already logged `emitted`. */
function armed(policy: BrowserConsolePolicy, ...emitted: { type: string; text: string; url?: string }[]) {
  let onConsole: ((m: unknown) => void) | undefined;
  const context = {
    on: (event: string, handler: (m: unknown) => void) => {
      if (event === 'console') onConsole = handler;
    },
  } as unknown as BrowserContext;
  installConsoleCapture(context, policy, 'experiment [phone]');
  for (const e of emitted) {
    onConsole?.({ type: () => e.type, text: () => e.text, location: () => ({ url: e.url ?? '' }) });
  }
  return context;
}

const err = { type: 'error', text: 'boom' };
const warn = { type: 'warning', text: 'careful' };

it('throws naming where and what, mapping playwright\'s "warning" to warn', () => {
  expect(() => assertConsoleClean(armed(BOTH, err)))
    .toThrow('console.error on experiment [phone]: boom');
  expect(() => assertConsoleClean(armed(BOTH, warn)))
    .toThrow('console.warn on experiment [phone]: careful');
});

it('ignores levels outside failOn, and log/info always', () => {
  expect(() => assertConsoleClean(armed(BOTH, { type: 'log', text: 'a' }, { type: 'info', text: 'b' })))
    .not.toThrow();
  expect(() => assertConsoleClean(armed({ failOn: ['error'], allowList: [] }, warn))).not.toThrow();
  expect(() => assertConsoleClean(armed({ failOn: [], allowList: [] }, err))).not.toThrow();
});

it('silences by message text or logging script url, case-sensitively', () => {
  expect(() => assertConsoleClean(armed({ failOn: ['error'], allowList: ['boo'] }, err))).not.toThrow();
  expect(() => assertConsoleClean(armed(
    { failOn: ['error'], allowList: ['cdn.test'] },
    { type: 'error', text: 'boom', url: 'https://cdn.test/w.js' },
  ))).not.toThrow();
  expect(() => assertConsoleClean(armed({ failOn: ['error'], allowList: ['Boo'] }, err))).toThrow('boom');
});

it('reports the first message the allowList does not cover', () => {
  expect(() => assertConsoleClean(armed(
    { failOn: ['error'], allowList: ['known'] },
    { type: 'error', text: 'known' }, { type: 'error', text: 'fresh' },
  ))).toThrow('console.error on experiment [phone]: fresh');
});

it('re-arming resets, and an unarmed context reports nothing', () => {
  const context = armed(BOTH, err);
  installConsoleCapture(context, BOTH, 'control [desktop]');
  expect(() => assertConsoleClean(context)).not.toThrow();
  expect(() => assertConsoleClean({} as BrowserContext)).not.toThrow();
});
