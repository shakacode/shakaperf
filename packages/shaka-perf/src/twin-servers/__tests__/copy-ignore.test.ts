/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'path';
import {
  createCopyIgnoreMatcher,
  isCopyIgnored,
  repositoryRelativeCopyPath,
} from '../helpers/copy-ignore';

describe('copy-ignore paths', () => {
  it('matches repository-relative overrides for events from a nested build context', () => {
    const repositoryRoot = path.join(path.sep, 'repo');
    const buildRoot = path.join(repositoryRoot, 'packages', 'web');
    const eventPath = repositoryRelativeCopyPath(
      repositoryRoot,
      buildRoot,
      path.join('tmp', 'traces', 'trace.json'),
    );
    const matcher = createCopyIgnoreMatcher({
      folders: ['packages/web/tmp/traces'],
      files: [],
    });

    expect(eventPath).toBe(path.join('packages', 'web', 'tmp', 'traces', 'trace.json'));
    expect(isCopyIgnored(matcher, eventPath)).toBe(true);
  });
});
