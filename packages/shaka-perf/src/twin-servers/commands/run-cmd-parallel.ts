/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ResolvedConfig } from '../types';
import { runInParallel } from '../helpers/shell';
import { colorize } from '../helpers/ui';

export interface RunCmdParallelOptions {
  verbose?: boolean;
}

/**
 * Runs a command in both experiment and control containers in parallel
 * with colorful tagged output.
 *
 * Usage:
 *   shaka-perf servers run-cmd-parallel "bundle exec rake db:migrate"
 */
export async function runCmdParallel(
  config: ResolvedConfig,
  command: string,
  options: RunCmdParallelOptions = {}
): Promise<void> {
  console.log(`Running in parallel: ${colorize(command, 'green')} in both containers`);

  const escaped = command.replace(/'/g, "'\\''");
  // Re-invoke whichever shaka-perf entrypoint started us through Node, so this
  // works even when a CI checkout/bind mount drops the executable bit from
  // dist/cli.js.
  const node = `'${process.execPath.replace(/'/g, "'\\''")}'`;
  const self = `'${process.argv[1].replace(/'/g, "'\\''")}'`;
  await runInParallel(
    `${node} ${self} servers run-cmd experiment '${escaped}'`,
    `${node} ${self} servers run-cmd control '${escaped}'`,
  );
}
