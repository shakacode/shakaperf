import { execSync } from 'child_process';
import * as path from 'path';
import * as http from 'http';

export const TMP_ROOT = '/tmp/temp-shaka-perf-repos-for-tests';
export const EXPERIMENT_CLONE_PATH = path.join(TMP_ROOT, 'shaka-perf');
export const CONTROL_CLONE_PATH = path.join(TMP_ROOT, 'shaka-perf-control');
export const ORIGINAL_REPO = path.resolve(__dirname, '..');
export const DEMO_CWD = path.join(EXPERIMENT_CLONE_PATH, 'demo-ecommerce');

export const env: Record<string, string> = {
  ...process.env as Record<string, string>,
  CONTROL_REPO_DIR: path.join(CONTROL_CLONE_PATH, 'demo-ecommerce'),
};


const GREEN_BOLD = '\x1b[1;32m';
const RESET = '\x1b[0m';

export function loud(msg: string): void {
  console.log(`\n${GREEN_BOLD}>>> ${msg}${RESET}\n`);
}

export function run(cmd: string, opts: { cwd?: string; timeout?: number } = {}): string {
  const { cwd = DEMO_CWD, timeout = 10 * 60 * 1000 } = opts;
  loud(`run: ${cmd}`);
  const output = execSync(cmd, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout,
  });
  const text = output.toString();
  if (text) console.log(text);
  return text;
}

export function waitForPort(port: number, timeout = 180_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - start > timeout) {
        return reject(new Error(`Port ${port} did not respond within ${timeout}ms`));
      }
      const req = http.get(`http://localhost:${port}/up`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(attempt, 2000);
        }
        res.resume();
      });
      req.on('error', () => setTimeout(attempt, 2000));
      req.setTimeout(5000, () => {
        req.destroy();
        setTimeout(attempt, 2000);
      });
    };
    attempt();
  });
}

const PUMA_CMD = 'bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000';

export function startServers(): void {
  loud('Starting puma in both containers');
  run(`yarn shaka-twin-servers run-cmd control "${PUMA_CMD} > /tmp/puma.log 2>&1 &"`);
  run(`yarn shaka-twin-servers run-cmd experiment "${PUMA_CMD} > /tmp/puma.log 2>&1 &"`);
}

export function stopServers(): void {
  loud('Stopping puma in both containers');
  try { run('yarn shaka-twin-servers run-cmd control "pkill -f puma || true"'); } catch { /* ignore */ }
  try { run('yarn shaka-twin-servers run-cmd experiment "pkill -f puma || true"'); } catch { /* ignore */ }
}
