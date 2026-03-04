import * as fs from 'fs';
import { spawn } from 'child_process';
import type { ResolvedConfig } from '../types';
import { requireCommand } from '../helpers/shell';
import { dockerComposeExec } from '../helpers/docker';
import { printBanner, printError } from '../helpers/ui';

export interface StartServersOptions {
  verbose?: boolean;
}

export async function startServers(
  config: ResolvedConfig,
  options: StartServersOptions = {}
): Promise<void> {
  const { verbose } = options;

  printBanner('Starting Rails Servers');

  if (!fs.existsSync(config.procfile)) {
    printError(`Procfile not found: ${config.procfile}`);
    process.exit(1);
  }

  requireCommand('overmind', 'brew install overmind (Mac) or go install github.com/DarthSim/overmind/ (Linux)');

  console.log('Starting servers via Overmind...');
  console.log('');

  return new Promise((resolve, reject) => {
    const child = spawn('overmind', [
      'start',
      '-f', config.procfile,
    ], {
      cwd: config.projectDir,
      stdio: 'inherit',
    });

    let cleanupDone = false;
    let isExiting = false;

    const cleanup = async () => {
      if (cleanupDone) return;
      cleanupDone = true;

      // Kill the child process if it's still running
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((res) => {
          const timeout = setTimeout(() => res(), 5000);
          child.once('close', () => {
            clearTimeout(timeout);
            res();
          });
        });
      }

      // Cleanup: kill any remaining overmind processes in containers
      for (const server of ['control-server', 'experiment-server']) {
        await dockerComposeExec(
          config,
          server,
          "cat /tmp/overmind-pid.* 2>/dev/null | xargs -i bash -c 'echo Killing PID: {} && kill {} || true'; rm -f /tmp/overmind-pid.*"
        );
      }
    };

    const signalHandler = async (signal: NodeJS.Signals) => {
      if (isExiting) return;
      isExiting = true;

      console.log(`\nReceived ${signal}, cleaning up...`);
      await cleanup();
      process.exit(0);
    };

    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    child.on('error', (error) => {
      reject(new Error(`Failed to start overmind: ${error.message}`));
    });

    child.on('close', async (code) => {
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);

      if (!isExiting) {
        await cleanup();
      }
      resolve();
    });
  });
}
