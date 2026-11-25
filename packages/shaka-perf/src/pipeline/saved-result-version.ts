/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { parse, SemVer } from 'semver';
import { version as shakaPerfVersion } from '../../package.json';

export { shakaPerfVersion };

const current = new SemVer(shakaPerfVersion);

export function isCompatibleSavedResult(record: unknown): boolean {
  if (!record || typeof record !== 'object' || !('shakaPerfVersion' in record)) return false;
  const saved = typeof record.shakaPerfVersion === 'string' ? parse(record.shakaPerfVersion) : null;
  return saved?.major === current.major && saved.minor === current.minor;
}
