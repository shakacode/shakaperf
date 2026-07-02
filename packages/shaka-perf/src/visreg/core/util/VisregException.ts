/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Scenario, Viewport } from '../types';

export default class VisregException {
  msg: string;
  scenario: Scenario;
  viewport: Viewport;
  originalError: Error;

  constructor (msg: string, scenario: Scenario, viewport: Viewport, originalError: Error) {
    this.msg = msg;
    this.scenario = scenario;
    this.viewport = viewport;
    this.originalError = originalError;
  }

  toString () {
    return 'VisregException: ' +
      this.scenario.label + ' on ' +
      this.viewport.label + ': ' +
      this.originalError.toString();
  }
}
