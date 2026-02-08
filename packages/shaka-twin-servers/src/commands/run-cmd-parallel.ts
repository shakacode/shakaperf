import type { ResolvedConfig } from '../types';
import { dockerComposeExec } from '../helpers/docker';

export interface RunCmdParallelOptions {
  verbose?: boolean;
}

const COLORS = {
  blue: '\x1b[1;34m',
  green: '\x1b[1;32m',
  reset: '\x1b[0m',
};

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
      ? `${COLORS.blue}[EXPERIMENT]${COLORS.reset}`
      : `${COLORS.green}[CONTROL]${COLORS.reset}`;

    const result = await dockerComposeExec(
      config,
      containerName,
      command,
      { interactive: true }
    );

    // Print output with prefix
    if (result.stdout) {
      for (const line of result.stdout.split('\n')) {
        if (line) console.log(`${prefix} ${line}`);
      }
    }
    if (result.stderr) {
      for (const line of result.stderr.split('\n')) {
        if (line) console.error(`${prefix} ${line}`);
      }
    }

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
