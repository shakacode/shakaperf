/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext } from 'playwright-core';

export interface BrowserConsolePolicy {
  readonly failOn: readonly ('error' | 'warn')[];
  readonly allowList: readonly string[];
}

interface Armed { policy: BrowserConsolePolicy; where: string; failure?: Error }

const armed = new WeakMap<BrowserContext, Armed>();

/**
 * An uncaught exception in the page never reaches `console` — Playwright routes
 * it to `pageerror` / `weberror` instead. Until this was captured, an
 * `addInitScript` that threw was completely invisible: the `addInitScript` call
 * still resolved, the run stayed green, and only the screenshots were wrong.
 * Treated as an 'error'-level event so it obeys the same `failOn` / `allowList`
 * knobs — `failOn: []` still turns the whole check off.
 */
function describePageError(error: Error): string {
  const message = error.message || String(error);
  // esbuild's `keepNames` rewrites named inner functions to `__name(fn, 'name')`,
  // a Node-module-scope helper. Serialize such a function into the page and it
  // dies on the first call, silently. Worth naming outright — the symptom
  // (a hide/stub that simply didn't happen) points nowhere near the cause.
  if (message.includes('__name is not defined')) {
    return `${message} — a function passed to addInitScript/evaluate was transpiled with ` +
      'esbuild `keepNames`, which injects the Node-only `__name` helper. Pass the script ' +
      'as a string instead of a function, or drop the named inner function.';
  }
  return message;
}

/**
 * Arm a context: the first console message or uncaught page error the policy
 * doesn't tolerate becomes the Error that `assertConsoleClean` throws. Re-arming
 * resets it (perf reuses one context per sample).
 */
export function installConsoleCapture(
  context: BrowserContext,
  policy: BrowserConsolePolicy,
  where: string,
): void {
  const existing = armed.get(context);
  if (existing) { Object.assign(existing, { policy, where, failure: undefined }); return; }

  const state: Armed = { policy, where };
  armed.set(context, state);

  // Both channels land here: same policy, same wording, one place to change.
  const report = (level: 'error' | 'warn', kind: string, text: string, url = '') => {
    if (state.failure) return;
    if (!state.policy.failOn.includes(level)) return;
    if (state.policy.allowList.some((a) => text.includes(a) || url.includes(a))) return;
    state.failure = new Error(`${kind} on ${state.where}: ${text}`);
  };

  context.on('console', (message) => {
    const type = message.type();
    const level = type === 'error' ? 'error' : type === 'warning' ? 'warn' : null;
    if (level) report(level, `console.${level}`, message.text(), message.location().url);
  });
  // `weberror` is the context-level `pageerror`: any page's uncaught exception.
  context.on('weberror', (webError) => {
    report('error', 'uncaught page error', describePageError(webError.error()));
  });
}

export function assertConsoleClean(context: BrowserContext): void {
  const failure = armed.get(context)?.failure;
  if (failure) throw failure;
}
