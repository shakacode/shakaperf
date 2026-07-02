/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import type { PipelineRunResult } from './runner';

/**
 * Print the human-facing report paths for a completed pipeline run, colored for
 * the terminal. Shared by every command that runs a pipeline (compare, audit, …)
 * so they stay in lockstep — including the full-report.zip bundle line.
 *
 * chalk auto-disables color when stdout isn't a TTY (piped output, CI), so this
 * is safe to call unconditionally.
 */
export function printReportSummary(result: PipelineRunResult): void {
  if (result.reportPath) {
    console.log(
      chalk.bold.cyan('\nShort report (for slack/email): ') +
        chalk.underline(result.shortReportPath || result.reportPath),
    );
    console.log(
      chalk.bold.magenta('Full report (for you): ') + chalk.underline(result.fullReportPath),
    );
    if (result.fullReportZipPath) {
      console.log(
        chalk.bold.green('Full report bundle (zip): ') + chalk.underline(result.fullReportZipPath),
      );
    }
  } else {
    console.log(
      chalk.yellow('\n--skip-report set: engine artifacts written, top-level report skipped.'),
    );
  }
}

/**
 * Print the failure summary in red and set a non-zero exit code so CI treats the
 * run as a failed assertion. No-op when the run had no failures.
 */
export function reportPipelineFailure(result: PipelineRunResult): void {
  if (result.hasFailures) {
    console.error(chalk.bold.red(`\nFAILED: ${result.failureSummary}`));
    process.exitCode = 1;
  }
}
