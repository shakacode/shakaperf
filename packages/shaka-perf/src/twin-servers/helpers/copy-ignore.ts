/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
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
