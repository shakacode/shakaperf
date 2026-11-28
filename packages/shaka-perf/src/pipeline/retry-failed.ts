/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const RETRY_FAILED_OPTION_DESCRIPTION =
  'Re-run only the tests that failed in the previous run, read from <results>/report.json. ' +
  'Ignores --filter. Cannot be combined with --report-only.';

/**
 * Chip tags that make a test count as failed. Keep in sync with
 * `summarizeFailures` in runner.ts, which decides the CLI exit code.
 */
const FAILING_CHIP_TAGS: ReadonlySet<string> = new Set([
  'broken',
  'regression',
  'visual change',
  'accessibility violation',
  'accessibility regression',
  'accessibility error',
  'accessibility blocked',
]);

interface MachineReportRow {
  name: string;
  chips?: readonly { tag: string }[];
  outcomes?: readonly { kind: string }[];
}

/** Names of the tests that failed at any viewport, in report order, deduped. */
export function failedTestNames(rows: readonly MachineReportRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    const errored = row.outcomes?.some((outcome) => outcome.kind === 'error') ?? false;
    const flagged = row.chips?.some((chip) => FAILING_CHIP_TAGS.has(chip.tag)) ?? false;
    if (errored || flagged) names.add(row.name);
  }
  return [...names];
}

/**
 * A `--filter` value matching exactly these names. Commas are written as
 * `\x2c` because the filter is split on commas into separate patterns.
 */
export function exactNamesFilter(names: readonly string[]): string {
  return names
    .map((name) => `^${name.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/,/g, '\\x2c')}$`)
    .join(',');
}

/**
 * Reads the previous run's `report.json` under `resultsRoot` and returns a
 * filter scoped to its failed tests, or `null` when none failed.
 */
export function retryFailedFilter(resultsRoot: string): string | null {
  const reportPath = path.join(resultsRoot, 'report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`--retry-failed: no previous run found (${reportPath} does not exist).`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as { tests?: MachineReportRow[] };
  const names = failedTestNames(report.tests ?? []);
  if (names.length === 0) return null;
  console.log(`--retry-failed: re-running ${names.length} failed test(s): ${names.join(', ')}`);
  return exactNamesFilter(names);
}

/**
 * Resolves the filter for a compare/audit run. Returns `undefined` filter
 * unchanged when `--retry-failed` is off, and `{ nothingToRetry: true }` when
 * the previous run had no failures.
 */
export function resolveRunFilter(input: {
  retryFailed: boolean;
  reportOnly: boolean;
  filter: string | undefined;
  resultsRoot: string;
}): { filter: string | undefined } | { nothingToRetry: true } {
  if (!input.retryFailed) return { filter: input.filter };
  if (input.reportOnly) throw new Error('--retry-failed cannot be combined with --report-only.');
  if (input.filter) console.warn(`--retry-failed: ignoring filter "${input.filter}".`);
  const filter = retryFailedFilter(input.resultsRoot);
  if (filter === null) {
    console.log('--retry-failed: the previous run had no failed tests; nothing to retry.');
    return { nothingToRetry: true };
  }
  return { filter };
}
