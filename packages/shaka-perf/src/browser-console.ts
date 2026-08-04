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
 * Arm a context: the first console message the policy doesn't tolerate becomes
 * the Error that `assertConsoleClean` throws. Re-arming resets it (perf reuses
 * one context per sample).
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
  context.on('console', (message) => {
    if (state.failure) return;
    const type = message.type();
    const level = type === 'error' ? 'error' : type === 'warning' ? 'warn' : null;
    if (!level || !state.policy.failOn.includes(level)) return;
    const text = message.text();
    const url = message.location().url;
    if (state.policy.allowList.some((a) => text.includes(a) || url.includes(a))) return;
    state.failure = new Error(`console.${level} on ${state.where}: ${text.slice(0, 500)}`);
  });
}

export function assertConsoleClean(context: BrowserContext): void {
  const failure = armed.get(context)?.failure;
  if (failure) throw failure;
}
