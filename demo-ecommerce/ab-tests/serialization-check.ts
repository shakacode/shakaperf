/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BeforeNavigateContext } from 'shaka-shared';

/**
 * Exercises the Node -> browser function boundary on every run, for free.
 *
 * Playwright serializes a function argument with `Function.prototype.toString`,
 * so the emitted source has to stand alone once it lands in the page. A
 * transform that injects runtime helpers breaks that: esbuild's `keepNames`
 * wraps the NAMED inner function below in its `__name` helper, which exists only
 * in the Node module scope. If that ever reaches the page again, this throws
 * `__name is not defined` at document start, the uncaught page error fails the
 * unit, and visreg.spec.ts pins its absence.
 *
 * It lives in its own file on purpose: `abtests.config.ts` then imports it with
 * a RELATIVE, EXTENSIONLESS specifier, which is the other thing the loader has
 * to get right and which no other fixture here covers. Both are no-ops for the
 * app — no extra work, no extra screenshots.
 */
export function installSerializationCheck({ context }: BeforeNavigateContext): Promise<void> {
  return context.addInitScript(() => {
    const mark = () => {
      (window as unknown as { __shakaPerfSerializationCheck?: boolean })
        .__shakaPerfSerializationCheck = true;
    };
    mark();
  });
}
