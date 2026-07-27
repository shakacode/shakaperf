/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CopyIgnoreConfig } from './types';

/** Host-only directories excluded from change copying unless config overrides them. */
export const DEFAULT_COPY_IGNORE_FOLDERS = [
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
