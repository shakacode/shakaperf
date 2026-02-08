import * as crypto from 'crypto';
import type { ResolvedConfig } from '../types';
import { dockerComposeExec } from '../helpers/docker';

export interface RunOvermindCommandOptions {
  verbose?: boolean;
}

export type ServerTarget = 'control' | 'experiment';

/**
 * Executes a command in a Docker container with proper PID handling for Overmind.
 *
 * This is designed to be called from a Procfile like:
 *   control-rails: shaka-twin-servers run-overmind-command control "bundle exec puma ..."
 *
 * The command:
 * 1. Generates a unique temp PID file path
 * 2. Runs the command in background, captures PID
 * 3. Outputs the PID (for Overmind to track)
 * 4. Waits for the process to complete
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

  // Build the wrapped command that:
  // 1. Runs the command in background
  // 2. Captures its PID to the temp file
  // 3. Outputs the PID
  // 4. Waits for completion
  const wrappedCommand = `${command} & echo $! > ${pidPath}; cat ${pidPath}; wait`;

  console.log(`Running \x1b[32m${command}\x1b[0m in ${containerName}`);

  const result = await dockerComposeExec(
    {
      composeFile: config.composeFile,
      cwd: config.projectDir,
      env: {
        CI_IMAGE_NAME: config.images.experiment,
        CI_CONTROL_IMAGE_NAME: config.images.control,
      },
    },
    containerName,
    wrappedCommand,
    { stream: true }
  );

  if (result.code !== 0) {
    throw new Error(`Command exited with code ${result.code}`);
  }
}
