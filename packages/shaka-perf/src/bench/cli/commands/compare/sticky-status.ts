/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';

// CSI / OSC ANSI sequence matcher. Built via new RegExp with \uXXXX
// escapes so the source has no raw control bytes.
const ANSI_REGEX = new RegExp(
  '[\\u001b\\u009b][[\\]()#;?]*' +
  '(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007)' +
  '|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
  'g',
);
const stripAnsi = (text: string): string => text.replace(ANSI_REGEX, '');

export interface StickyStatus {
  set(text: string): void;
  dispose(): void;
}

interface PhaseProgress {
  stageName: string;
  stageDescription: string;
  stageIndex: number;
  totalStages: number;
  skipOption: string;
  start: number;
  completed: number;
  totalSamples: number | null;
  parallelism: number;
  active: number;
  errors: number;
}

// Until the first sample finishes we have no measured rate, so a divide
// would render "0m:0s" — looks like the stage is already done. Seed with
// a coarse 5s/sample guess so the initial estimate is in the right
// ballpark; the next onProgress overwrites it with the real average.
const INITIAL_SAMPLE_DURATION_MS = 5_000;

const BAR_WIDTH = 16;

// `secondsToTime` only renders mm:ss and silently drops hours
// (`secondsToTime(21600)` → "00m:00s"), which makes the initial estimate
// for a long stage look like the work is already done. Use an
// hours-aware formatter for the sticky meter.
function formatRemainingDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return h > 0 ? `${h.toString().padStart(2, '0')}h:${m}m:${s}s` : `${m}m:${s}s`;
}

function progressBar(fraction: number | null): string {
  if (fraction == null) {
    return chalk.gray('░'.repeat(BAR_WIDTH));
  }
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * BAR_WIDTH);
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(BAR_WIDTH - filled));
}

function formatProgressStatus(progress: PhaseProgress): string {
  const averageMs = progress.completed > 0
    ? (Date.now() - progress.start) / progress.completed
    : INITIAL_SAMPLE_DURATION_MS;
  const remaining = progress.totalSamples == null
    ? null
    : Math.max(0, progress.totalSamples - progress.completed);
  const eta = remaining == null
    ? chalk.gray('--:--')
    : chalk.red(formatRemainingDuration(Math.round((remaining * averageMs) / 1000)));
  const fraction = progress.totalSamples && progress.totalSamples > 0
    ? progress.completed / progress.totalSamples
    : null;
  const percentText = fraction == null
    ? chalk.gray('  --%')
    : chalk.red(`${Math.min(100, Math.round(fraction * 100)).toString().padStart(3, ' ')}%`);
  const counter = progress.totalSamples == null
    ? chalk.red(`${progress.completed}`)
    : chalk.red(`${progress.completed}/${progress.totalSamples}`);
  const stageHeader = chalk.bold(
    `[${progress.stageIndex}/${progress.totalStages}] ${chalk.gray('stage:')}${chalk.cyan(progress.stageName)}`,
  );
  const pool = chalk.gray('pool ') +
    chalk.yellow(`${progress.active}/${progress.parallelism}`) +
    chalk.gray(' active') +
    (progress.errors > 0 ? chalk.red(` · ${progress.errors} errors`) : '');
  const sep = chalk.gray(' · ');
  const meterLine =
    `${progressBar(fraction)} ${percentText}${sep}` +
    `${counter} done${sep}` +
    `${pool}${sep}` +
    `ETA ${eta}${sep}` +
    chalk.gray(`to skip this stage use ${chalk.cyan(progress.skipOption)}`);
  return `${stageHeader}\n${chalk.gray(progress.stageDescription)}\n${meterLine}`;
}

/**
 * Render a worker-pool snapshot as the sticky status line. The pool
 * owns the throughput counters; the runner supplies the stage-relative
 * fields (which stage of how many, skip hint).
 */
export function formatPoolProgress(
  snapshot: {
    startedAt: number;
    completed: number;
    expectedTotal: number | null;
    parallelism: number;
    active: number;
    errors: number;
  },
  stage: {
    name: string;
    description: string;
    index: number;
    total: number;
    skipOption: string;
  },
): string {
  return formatProgressStatus({
    stageName: stage.name,
    stageDescription: stage.description,
    stageIndex: stage.index,
    totalStages: stage.total,
    skipOption: stage.skipOption,
    start: snapshot.startedAt,
    completed: snapshot.completed,
    totalSamples: snapshot.expectedTotal,
    parallelism: snapshot.parallelism,
    active: snapshot.active,
    errors: snapshot.errors,
  });
}

/**
 * Pin a multi-line status block to the bottom of the terminal. Subsequent
 * writes to stdout / stderr from anywhere in the process scroll above it: we
 * patch `process.stdout.write` and `process.stderr.write` to clear the sticky
 * block before each write and re-render it after, so the block stays visible
 * across concurrent log activity (parent banners, forwarded worker IPC log
 * frames routed through console.log, child process stderr, etc).
 *
 * Non-TTY (CI, piped output): no-op — every operation is a pass-through and
 * stdout / stderr aren't patched.
 *
 * Constraints:
 *   - Assumes line-terminated writes. A bare `process.stdout.write('partial')`
 *     leaves the cursor mid-line and the sticky re-render will overlay it.
 *     `console.log` (line-buffered) and the IPC log forwarder (per-frame)
 *     both honor this; that covers all of shaka-perf's hot paths.
 *   - Only one StickyStatus may be attached per process at a time.
 */
// Nested attaches (e.g. bench's per-phase attach inside a runner-owned
// attach) become no-ops so the inner painter doesn't fight the outer one
// over process.stdout.write.
let stickyOwned = false;

export function attachStickyStatus(): StickyStatus {
  if (!process.stdout.isTTY || stickyOwned) {
    return { set: () => {}, dispose: () => {} };
  }
  stickyOwned = true;

  let current = '';
  let active = true;

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  // \r        — cursor to column 0
  // \x1b[2K   — erase entire current row
  // \x1b[1A   — cursor up one row
  function clearSticky(): void {
    if (!current) return;
    const cols = process.stdout.columns || Number.POSITIVE_INFINITY;
    const lines = stripAnsi(current).split('\n');
    const totalRows = lines.reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(line.length / cols)),
      0,
    );
    let seq = '\r\u001b[2K';
    for (let i = 1; i < totalRows; i++) seq += '\u001b[1A\u001b[2K';
    origStdoutWrite(seq);
  }

  function renderSticky(): void {
    if (!current) return;
    origStdoutWrite(current);
  }

  function wrap(orig: typeof origStdoutWrite): typeof origStdoutWrite {
    return ((chunk: unknown, ...args: unknown[]): boolean => {
      if (!active) return (orig as (...a: unknown[]) => boolean)(chunk, ...args);
      clearSticky();
      const result = (orig as (...a: unknown[]) => boolean)(chunk, ...args);
      renderSticky();
      return result;
    }) as typeof origStdoutWrite;
  }

  process.stdout.write = wrap(origStdoutWrite);
  process.stderr.write = wrap(origStderrWrite);

  return {
    set(text: string): void {
      if (!active || text === current) return;
      clearSticky();
      current = text;
      renderSticky();
    },
    dispose(): void {
      if (!active) return;
      clearSticky();
      current = '';
      active = false;
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
      stickyOwned = false;
    },
  };
}
