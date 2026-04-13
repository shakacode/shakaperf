import type { ResolvedConfig } from '../types';
import { dockerComposeExec } from '../helpers/docker';
import { colorize } from '../helpers/ui';

export interface RunCmdOptions {
  verbose?: boolean;
}

export type ServerTarget = 'control' | 'experiment';

/**
 * Executes a command in a Docker container interactively.
 *
 * Usage:
 *   shaka-perf twins-run-cmd control "bundle exec rails console"
 *   shaka-perf twins-run-cmd experiment "yarn test"
 */
export async function runCmd(
  config: ResolvedConfig,
  target: ServerTarget,
  command: string,
  options: RunCmdOptions = {}
): Promise<void> {
  const containerName = target === 'control' ? 'control-server' : 'experiment-server';

  console.log(`Running ${colorize(command, 'green')} in ${containerName}`);

  const result = await dockerComposeExec(
    config,
    containerName,
    command,
    { interactive: true, stream: true }
  );

  if (result.code !== 0) {
    throw new Error(`Command exited with code ${result.code}`);
  }
}
