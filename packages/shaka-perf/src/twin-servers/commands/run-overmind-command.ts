import * as crypto from 'crypto';
import type { ResolvedConfig } from '../types';
import { dockerComposeExec } from '../helpers/docker';
import { colorize } from '../helpers/ui';

export interface RunOvermindCommandOptions {
  verbose?: boolean;
}

export type ServerTarget = 'control' | 'experiment';

/**
 * Executes a command in a Docker container with proper PID handling for Overmind.
 *
 * This is designed to be called from a Procfile like:
 *   control-rails: shaka-perf twin-servers run-overmind-command control "bundle exec puma ..."
 *
 * The command:
 * 1. Generates a unique temp file path
 * 2. Saves the shell's session ID to the temp file (for session-wide cleanup later)
 * 3. Runs the command in the foreground
 */
export async function runOvermindCommand(
  config: ResolvedConfig,
  target: ServerTarget,
  command: string,
  options: RunOvermindCommandOptions = {}
): Promise<void> {
  const { verbose } = options;

  const containerName = target === 'control' ? 'control-server' : 'experiment-server';

  // Generate unique PID file path (mimics mktemp /tmp/overmind-pid.XXXXXXXXXXXXXXXX)
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const pidPath = `/tmp/overmind-pid.${randomSuffix}`;

  if (verbose) {
    console.log(`PID path: ${pidPath} for ${command.split(' ')[0]}`);
  }

  // Save the shell's session ID to a temp file (for session-wide cleanup later),
  // then run the command in the foreground.
  const wrappedCommand = `echo $$ > ${pidPath}; echo "$$ ${command}"; ${command}`;

  console.log(`Running ${colorize(command, 'green')} in ${containerName}`);

  const result = await dockerComposeExec(
    config,
    containerName,
    wrappedCommand,
    { stream: true }
  );

  if (result.code !== 0) {
    throw new Error(`Command exited with code ${result.code}`);
  }
}
