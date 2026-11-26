/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useState } from 'react';
import type { ReportMeta, TestResult } from '../../types';

// Tie review to the saved results, not the report that happens to display them.
// Include every stage/viewport: a partial rerun can replace just one outcome.
export function reviewedKey(meta: ReportMeta, test: TestResult): string {
  const outcomes = test.outcomes.map((outcome) => JSON.stringify([
    outcome.stage,
    outcome.executionDetails.viewport.label,
    outcome.executionDetails.viewport.width,
    outcome.executionDetails.viewport.height,
    outcome.executionDetails.runId,
  ])).sort();
  return `shaka-perf:reviewed:v2:${JSON.stringify([
    meta.cwd, meta.pipelineName, test.id, outcomes,
  ])}`;
}

function readReviewed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeReviewed(key: string, reviewed: boolean): void {
  try {
    if (reviewed) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // Storage blocked (private window, file:// quirks): the mark lasts the session.
  }
}

export function useReviewed(meta: ReportMeta, test: TestResult) {
  const key = reviewedKey(meta, test);
  const [reviewed, setReviewed] = useState(() => readReviewed(key));

  function updateReviewed(checked: boolean) {
    writeReviewed(key, checked);
    setReviewed(checked);
  }

  return { reviewed, updateReviewed };
}

export function ReviewedCheckbox({ reviewed, onChange }: {
  reviewed: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="card__pills">
      <label className="card__reviewed">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={event => onChange(event.currentTarget.checked)}
        />
        reviewed
      </label>
    </div>
  );
}
