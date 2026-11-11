/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaStack-1.0-ShakaPerf
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import type { CopyIgnoreConfig } from './types';

/** Host-only directories excluded from change copying unless config overrides them. */
export const DEFAULT_COPY_IGNORE_FOLDERS = [
  'audit-results',
  'compare-results',
  'compare-bisect-results',
] as const;

/** Host-only files excluded from change copying unless config overrides them. */
export const DEFAULT_COPY_IGNORE_FILES: readonly string[] = [];

export function defaultCopyIgnoreConfig(): CopyIgnoreConfig {
  return {
    folders: [...DEFAULT_COPY_IGNORE_FOLDERS],
    files: [...DEFAULT_COPY_IGNORE_FILES],
  };
}
