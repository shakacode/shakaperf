/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';
import path from 'node:path';

import makeConfig from '../../../../src/visreg/core/util/makeConfig';

describe('makeConfig', function () {
  it('throws when no config path is provided', async function () {
    await assert.rejects(
      makeConfig({}),
      /no config path provided/,
    );
  });

  it('throws when options is omitted entirely', async function () {
    await assert.rejects(
      makeConfig(),
      /no config path provided/,
    );
  });

  it('throws when the supplied config path does not exist', async function () {
    const missing = path.join(__dirname, 'this-file-does-not-exist.js');
    await assert.rejects(
      makeConfig({ config: missing }),
      new RegExp(`config not found at ${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });
});
