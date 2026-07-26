/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';
import type { AbTestDefinition } from 'shaka-shared';
import type { BisectTestSelection } from './types';

export function filterFrozenTests(
  tests: readonly AbTestDefinition[],
  cwd: string,
  selections: readonly BisectTestSelection[],
): AbTestDefinition[] {
  if (selections.length === 0) return [...tests];
  const wanted = new Set(selections.map((selection) => testSelectionKey(cwd, selection)));
  return tests.filter((test) => {
    if (!test.file) return false;
    return wanted.has(testSelectionKey(cwd, {
      testFile: test.file,
      testName: test.name,
    }));
  });
}

function testSelectionKey(cwd: string, selection: BisectTestSelection): string {
  return JSON.stringify([
    normalizeRelativeTestFile(cwd, selection.testFile),
    selection.testName,
  ]);
}

export function normalizeRelativeTestFile(cwd: string, testFile: string): string {
  const relative = path.isAbsolute(testFile) ? path.relative(cwd, testFile) : testFile;
  return path.posix.normalize(relative.replace(/\\/g, '/')).replace(/^\.\//, '');
}
