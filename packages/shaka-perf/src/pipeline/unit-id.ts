/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as crypto from 'node:crypto';
import type { AbTestDefinition } from 'shaka-shared';

export function slugifyForPath(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'test';
}

export function unitIdForTest(test: AbTestDefinition, viewportLabel: string): string {
  const source = [
    test.file ?? '',
    test.line ?? '',
    test.name,
    viewportLabel,
  ].join('\0');
  const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 8);
  return `${slugifyForPath(test.name)}-${viewportLabel}-${hash}`;
}

export function testIdForTest(test: AbTestDefinition): string {
  const source = [
    test.file ?? '',
    test.line ?? '',
    test.name,
  ].join('\0');
  const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 8);
  return `${slugifyForPath(test.name)}-${hash}`;
}
