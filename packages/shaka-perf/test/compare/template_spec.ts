/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';
import { parseAbTestsConfig } from '../../src/config';
import templateConfig from '../../templates/abtests.config';

describe('templates/abtests.config.ts', function () {
  it('parses cleanly through the zod schema', function () {
    // `shaka-perf init` copies this file verbatim as every new user's starting
    // config. A schema drift here silently breaks adoption — the user sees a
    // cryptic "AbTestsConfigSchema" error on their first `shaka-perf compare`.
    assert.doesNotThrow(() => parseAbTestsConfig(templateConfig));
  });
});
