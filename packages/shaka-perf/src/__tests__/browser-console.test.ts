/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext } from 'playwright-core';
import { assertConsoleClean, installConsoleCapture, type BrowserConsolePolicy } from '../browser-console';

const BOTH: BrowserConsolePolicy = { failOn: ['error', 'warn'], allowList: [] };

type Handlers = Record<string, ((arg: never) => void) | undefined>;

/** A mock context that records the handlers `installConsoleCapture` attaches. */
function mockContext(policy: BrowserConsolePolicy) {
  const handlers: Handlers = {};
  const context = {
    on: (event: string, handler: (arg: never) => void) => { handlers[event] = handler; },
    pages: () => [],
  } as unknown as BrowserContext;
  installConsoleCapture(context, policy, 'experiment [phone]');
  return { context, handlers };
}

/** A context armed with `policy` that has already logged `emitted`. */
function armed(policy: BrowserConsolePolicy, ...emitted: { type: string; text: string; url?: string }[]) {
  const { context, handlers } = mockContext(policy);
  for (const e of emitted) {
    (handlers.console as ((m: unknown) => void) | undefined)?.(
      { type: () => e.type, text: () => e.text, location: () => ({ url: e.url ?? '' }) },
    );
  }
  return context;
}

/** A context armed with `policy` that has since thrown `error` in the page. */
function threw(policy: BrowserConsolePolicy, error: Error) {
  const { context, handlers } = mockContext(policy);
  (handlers.weberror as ((w: unknown) => void) | undefined)?.({ error: () => error });
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

it('reports an uncaught page error, which never reaches the console channel', () => {
  expect(() => assertConsoleClean(threw(BOTH, new Error('kaboom'))))
    .toThrow('uncaught page error on experiment [phone]: kaboom');
});

it('gates page errors on failOn error, and silences them by allowList', () => {
  expect(() => assertConsoleClean(threw({ failOn: [], allowList: [] }, new Error('kaboom')))).not.toThrow();
  expect(() => assertConsoleClean(threw({ failOn: ['warn'], allowList: [] }, new Error('kaboom')))).not.toThrow();
  expect(() => assertConsoleClean(threw({ failOn: ['error'], allowList: ['kab'] }, new Error('kaboom')))).not.toThrow();
});

it('explains __name, the transpiler helper that cannot exist in the page', () => {
  expect(() => assertConsoleClean(threw(BOTH, new Error('__name is not defined'))))
    .toThrow(/keepNames.*Pass the script as a string/s);
});

it('re-arming resets, and an unarmed context reports nothing', () => {
  const context = armed(BOTH, err);
  installConsoleCapture(context, BOTH, 'control [desktop]');
  expect(() => assertConsoleClean(context)).not.toThrow();
  expect(() => assertConsoleClean({} as BrowserContext)).not.toThrow();
});
