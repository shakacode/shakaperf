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
 *   shaka-perf twins-run-cmd-parallel "bundle exec rake db:migrate"
 */
export async function runCmdParallel(
  config: ResolvedConfig,
  command: string,
  options: RunCmdParallelOptions = {}
): Promise<void> {
  console.log(`Running in parallel: ${colorize(command, 'green')} in both containers`);

  const escaped = command.replace(/'/g, "'\\''");
  await runInParallel(
    `yarn shaka-perf twins-run-cmd experiment '${escaped}'`,
    `yarn shaka-perf twins-run-cmd control '${escaped}'`,
  );
}
