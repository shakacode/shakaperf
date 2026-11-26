/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useState } from 'react';
import type { TestResult } from '../../types';
import { Dialog } from '../../../../src/report-ui/controls/Dialog';
import { TestSummaryMetadata } from './TestSummaryMetadata';
import { AnsiLog, firstElapsedSeconds } from './AnsiLog';

interface LogEntry {
  label: string;
  body: string;
  /**
   * Sort key for chronological ordering. The runner stamps every log line
   * with a `<X.Ys>` elapsed tag; we pull the first one as the section's
   * start time. Skipped/empty bodies fall back to `+Infinity` so they
   * always sink to the bottom rather than steal the top slot with a 0.
   */
  sortKey: number;
}

function logsForTest(test: TestResult, visibleStages: ReadonlySet<string>): LogEntry[] {
  const logs: LogEntry[] = [];
  for (const outcome of test.outcomes) {
    if (!visibleStages.has(outcome.stage)) continue;
    const titleSuffix = ` · ${outcome.executionDetails.viewport.label}`;
    if (outcome.logs) {
      const sortKey = firstElapsedSeconds(outcome.logs);
      logs.push({
        label: `${outcome.stage}${titleSuffix}`,
        body: outcome.logs,
        sortKey: sortKey ?? Number.POSITIVE_INFINITY,
      });
    }
    if (outcome.kind === 'skipped') {
      logs.push({
        label: `${outcome.stage} skipped${titleSuffix}`,
        body: outcome.reason ?? 'skipped',
        sortKey: Number.POSITIVE_INFINITY,
      });
    }
  }
  logs.sort((a, b) => a.sortKey - b.sortKey || a.label.localeCompare(b.label));
  return logs;
}

export function TestLogsButton({ test, visibleStages }: {
  test: TestResult;
  visibleStages: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const logs = logsForTest(test, visibleStages);
  if (logs.length === 0) return null;

  return (
    <div className="card__actions">
      <button
        type="button"
        className="card__logs-button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="Logs for this test"
      >
        logs
      </button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={<span className="ui-dialog__title-text">measurement logs · {test.name}</span>}
          meta={<TestSummaryMetadata test={test} defaultExpanded variant="dialog" />}
        >
          <div className="card-logs">
            {logs.map((log, index) => (
              <section key={`${log.label}-${index}`} className="card-logs__section">
                <div className="card-logs__label">{log.label}</div>
                <AnsiLog text={log.body} className="error-log" errorClassName="error-log__line--error" />
              </section>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
