import { spawn, execSync } from 'child_process';
import type { ResolvedConfig } from '../types';
import { printBanner, printSuccess, printWarning, colorize } from '../helpers/ui';

export interface ForwardPortsOptions {
  verbose?: boolean;
  controlPort?: string;
  experimentPort?: string;
}

export interface SshTarget {
  host: string;
  port: string;
}

const DEFAULT_CONTROL_PORT = '3020';
const DEFAULT_EXPERIMENT_PORT = '3030';

interface PortMapping {
  local: string;
  remote: string;
}

/**
 * Parse a port string that can be either "port" or "local:remote".
 * Examples:
 *   "3000" → { local: "3000", remote: "3000" }
 *   "3000:3000" → { local: "3000", remote: "3000" }
 *   "3010:3020" → { local: "3010", remote: "3020" }
 */
function parsePortMapping(portStr: string): PortMapping {
  if (portStr.includes(':')) {
    const [local, remote] = portStr.split(':');
    return { local, remote };
  }
  return { local: portStr, remote: portStr };
}

/**
 * Check if a port is already in use.
 */
function checkPort(port: string, name: string): boolean {
  try {
    execSync(`lsof -i :${port}`, { stdio: 'pipe' });
    printWarning(`Port ${port} is already in use for ${name}`);
    console.log('   You may need to stop the local twin servers first:');
    console.log('   docker compose down');
    console.log('');
    return true;
  } catch {
    return false;
  }
}

/**
 * Forwards ports from a remote CI server to localhost.
 * Used for accessing Twin Servers running in CI from your local machine.
 *
 * Usage:
 *   shaka-twin-servers forward-ports -p <port> <host>
 */
export async function forwardPorts(
  config: ResolvedConfig,
  sshTarget: SshTarget,
  options: ForwardPortsOptions = {}
): Promise<void> {
  const { verbose } = options;
  const { host, port } = sshTarget;

  const controlMapping = parsePortMapping(options.controlPort || DEFAULT_CONTROL_PORT);
  const experimentMapping = parsePortMapping(options.experimentPort || DEFAULT_EXPERIMENT_PORT);

  printBanner('SSH Port Forwarding to a CI Job with running Twin Servers');

  console.log('Setting up SSH port forwarding...');
  console.log(`   Remote host: ${host}:${port}`);
  console.log(`   Control server: localhost:${controlMapping.local} -> remote:${controlMapping.remote}`);
  console.log(`   Experiment server: localhost:${experimentMapping.local} -> remote:${experimentMapping.remote}`);
  console.log('');

  // Check if ports are already in use
  checkPort(controlMapping.local, 'Control Server');
  checkPort(experimentMapping.local, 'Experiment Server');

  console.log('Starting SSH port forwarding...');
  console.log('   Press Ctrl+C to stop');
  console.log('');

  // Start SSH port forwarding in the background
  const sshArgs = [
    '-N',
    '-L', `${controlMapping.local}:localhost:${controlMapping.remote}`,
    '-L', `${experimentMapping.local}:localhost:${experimentMapping.remote}`,
    '-p', port,
    host
  ];

  if (verbose) {
    console.log(colorize(`Running: ssh ${sshArgs.join(' ')}`, 'yellow'));
  }

  const sshProcess = spawn('ssh', sshArgs, {
    stdio: 'inherit'
  });

  // Handle cleanup on exit
  const cleanup = () => {
    console.log('');
    console.log('Stopping SSH port forwarding...');
    sshProcess.kill();
    printSuccess('Port forwarding stopped');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  printSuccess('Port forwarding active!');
  console.log('');
  printBanner('CI Twin Servers Accessible Locally');
  console.log(`Control Server:    http://localhost:${controlMapping.local}`);
  console.log(`Experiment Server: http://localhost:${experimentMapping.local}`);
  console.log('==========================================');

  // Wait for the SSH process to exit
  return new Promise((resolve, reject) => {
    sshProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`SSH process exited with code ${code}`));
      }
    });

    sshProcess.on('error', (err) => {
      reject(err);
    });
  });
}
