/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { TestResult } from '../types';

interface SkipGroup {
  reason: string;
  count: number;
}

function skipGroups(tests: TestResult[]): SkipGroup[] {
  const counts = new Map<string, number>();
  for (const test of tests) {
    for (const outcome of test.outcomes) {
      if (outcome.kind !== 'skipped') continue;
      const reason = outcome.reason ?? 'skipped';
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function SkippedChips({ tests }: { tests: TestResult[] }) {
  const groups = skipGroups(tests);
  if (groups.length === 0) return null;
  return (
    <div className="skip-chips" aria-label="skipped tests grouped by reason">
      {groups.map((group) => (
        <span key={group.reason} className="skip-chip" title={group.reason}>
          {group.count} skipped: {group.reason}
        </span>
      ))}
    </div>
  );
}
