/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';

export const COPY_IGNORE_FILENAME = '.shaka-perf-copyignore';
const DEFAULT_COPY_IGNORE_PATH = path.join(__dirname, 'default-copyignore');

function addIgnoreFile(matcher: Ignore, ignorePath: string): void {
  if (fs.existsSync(ignorePath)) {
    matcher.add(fs.readFileSync(ignorePath, 'utf8'));
  }
}

export function loadCopyIgnore(repositoryRoot: string): Ignore {
  const matcher = ignore();
  addIgnoreFile(matcher, DEFAULT_COPY_IGNORE_PATH);
  addIgnoreFile(matcher, path.join(repositoryRoot, COPY_IGNORE_FILENAME));
  return matcher;
}

export function isCopyIgnored(matcher: Ignore, relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join('/').replace(/^\.\//, '');
  return matcher.ignores(normalized) || matcher.ignores(`${normalized}/`);
}
