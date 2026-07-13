/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BisectCategory, BisectSession, BisectTarget } from './types';

const categoryPriority: Record<BisectCategory, number> = {
  visreg: 0,
  perf: 1,
  accessibility: 2,
};

export function writeSessionAtomic(filePath: string, session: BisectSession): void {
  writeJsonAtomic(filePath, session);
}

export function writeSummary(filePath: string, session: BisectSession): void {
  writeJsonAtomic(filePath, {
    version: session.version,
    status: session.status,
    goodSha: session.goodSha,
    badSha: session.badSha,
    dryRun: session.dryRun,
    nextAction: session.nextAction,
    targets: [...session.targets].sort(compareTargets),
  });
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function compareTargets(left: BisectTarget, right: BisectTarget): number {
  return categoryPriority[left.category] - categoryPriority[right.category]
    || left.testFile.localeCompare(right.testFile)
    || left.testName.localeCompare(right.testName)
    || left.viewport.localeCompare(right.viewport)
    || left.subject.localeCompare(right.subject)
    || left.id.localeCompare(right.id);
}
