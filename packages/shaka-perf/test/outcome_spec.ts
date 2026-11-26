/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { stageIds } from '../src/stage/stage-ids';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { shakaPerfVersion } from '../src/pipeline/saved-result-version';
import { parseOutcome } from '../src/pipeline/outcome';

it('reads the canonical execution record without converting old fields', () => {
  const saved = {
    shakaPerfVersion, kind: 'ok', stage: stageIds.visreg,
    executionDetails: { command: 'shaka-perf compare', viewport: DESKTOP_VIEWPORT, testSourceHref: null, runId: 'fixture-run', taskRetries: 1, taskRetryLimit: 2, recoveredAfterRetries: true },
  };
  expect(parseOutcome(JSON.stringify(saved))).toEqual(saved);
});

it('ignores unversioned, malformed and different-major records before reading their payload', () => {
  const [major, minor] = shakaPerfVersion.split('.');
  for (const version of [undefined, 'invalid', 7, `${Number(major) + 1}.${minor}.0`]) {
    expect(parseOutcome(JSON.stringify({ shakaPerfVersion: version, obsolete: true }))).toBeNull();
  }
});
