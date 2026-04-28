import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { say } from './say';
import type { ResolvedConfig } from '../types';

export interface NotifyServerStartedOptions {
  /** Passed verbatim to `dockerize -timeout`. */
  timeout?: string;
}

/**
 * Used in the Procfile to announce that a server is up. Wraps the original
 * inline `dockerize -wait ... && twins-say ... && echo ... && sleep infinity`
 * chain so the URL is derived from `config.ports`, not hardcoded into a string
 * the user has to update by hand whenever they change the port.
 *
 * Concurrent invocations from sibling Procfile processes don't trample each
 * other's announcement: `say()` takes a per-user file lock so the two
 * "<X> server started" utterances queue up serially.
 */
export async function notifyServerStarted(
  config: ResolvedConfig,
  target: 'control' | 'experiment',
  options: NotifyServerStartedOptions = {},
): Promise<void> {
  const { timeout = '60s' } = options;
  const port = config.ports[target];
  const url = `http://localhost:${port}`;
  const label = target === 'control' ? 'Control' : 'Experiment';
  // Hyphens and underscores trip up TTS pronunciation ("demo-ecommerce"
  // becomes "demo dash ecommerce" on some backends), so flatten to spaces.
  const appName = path.basename(config.projectDir).replace(/[-_]+/g, ' ');

  await waitForUrl(url, timeout);

  await say(`${appName} ${label} server started`);
  console.log(`visit ${url} to access the ${target} server`);

  // Overmind expects each Procfile process to stay alive; resolving here
  // would let it think the server stopped and trigger a restart loop. A
  // bare unresolved Promise does NOT keep Node alive — the event loop only
  // stays up while a refed handle (timer, socket, stdin) is open — so we
  // arm a long-lived no-op interval to hold the process.
  await new Promise<never>(() => {
    setInterval(() => {}, 1 << 30);
  });
}

function waitForUrl(url: string, timeout: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('dockerize', ['-wait', url, '-timeout', timeout], {
      stdio: 'inherit',
    });
    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn dockerize (is it installed?): ${err.message}`));
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`dockerize exited with code ${code} while waiting for ${url}`));
    });
  });
}

