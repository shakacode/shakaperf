/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { BisectInterruptedError } from './run-candidate';

/** Owns wall-clock access and cancellation state for one bisect lifecycle. */
export class BisectRunEnvironment {
  private cancellationSignal: NodeJS.Signals | null = null;

  constructor(private readonly clock: () => string = () => new Date().toISOString()) {}

  now(): string {
    return this.clock();
  }

  cancel(signal: NodeJS.Signals): void {
    this.cancellationSignal ??= signal;
  }

  checkCancellation(): void {
    if (this.cancellationSignal) throw new BisectInterruptedError(this.cancellationSignal);
  }

  signal(): NodeJS.Signals | null {
    return this.cancellationSignal;
  }
}
