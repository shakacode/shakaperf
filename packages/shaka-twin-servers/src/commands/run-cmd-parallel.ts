import type { ResolvedConfig } from '../types';
import { dockerComposeExec } from '../helpers/docker';
import { colorize } from '../helpers/ui';

export interface RunCmdParallelOptions {
  verbose?: boolean;
}

/**
 * Runs a command in both experiment and control containers in parallel
 * with colorful tagged output.
 *
 * Usage:
 *   shaka-twin-servers run-cmd-parallel "bundle exec rake db:migrate"
 */
export async function runCmdParallel(
  config: ResolvedConfig,
  command: string,
  options: RunCmdParallelOptions = {}
): Promise<void> {
  const { verbose } = options;

  if (verbose) {
    console.log(`Running in parallel: ${command}`);
  }

  const runInContainer = async (target: 'experiment' | 'control') => {
    const containerName = target === 'control' ? 'control-server' : 'experiment-server';
    const prefix = target === 'experiment'
      ? colorize('[EXPERIMENT]', 'blue')
      : colorize('[CONTROL]', 'green');

    const result = await dockerComposeExec(
      config,
      containerName,
      command,
      { interactive: true, prefix }
    );

    return { target, code: result.code };
  };

  const results = await Promise.all([
    runInContainer('experiment'),
    runInContainer('control'),
  ]);

  const failures = results.filter(r => r.code !== 0);
  if (failures.length > 0) {
    const failedTargets = failures.map(f => f.target).join(', ');
    throw new Error(`Command failed in: ${failedTargets}`);
  }
}
