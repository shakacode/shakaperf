/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaStack-1.0-ShakaPerf
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import * as path from 'path';
import ignore, { type Ignore } from 'ignore';
import type { CopyIgnoreConfig } from '../types';

export function createCopyIgnoreMatcher(config: CopyIgnoreConfig): Ignore {
  const matcher = ignore();
  matcher.add(config.folders.map((folder) => `${folder.replace(/\/+$/, '')}/`));
  matcher.add(config.files);
  return matcher;
}

export function isCopyIgnored(matcher: Ignore, relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join('/').replace(/^\.\//, '');
  return matcher.ignores(normalized) || matcher.ignores(`${normalized}/`);
}

/** Convert a path reported relative to a source subtree into repository-relative form. */
export function repositoryRelativeCopyPath(
  repositoryRoot: string,
  sourceRoot: string,
  sourceRelativePath: string,
): string {
  return path.relative(
    repositoryRoot,
    path.resolve(sourceRoot, sourceRelativePath),
  );
}
