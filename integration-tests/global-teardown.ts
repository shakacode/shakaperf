import { execSync } from 'child_process';
import * as fs from 'fs';
import { DEMO_CWD, composeEnv, loud } from './helpers';

export default async function globalTeardown() {
  if (fs.existsSync(DEMO_CWD)) {
    try {
      loud('Running docker compose down');
      execSync('docker compose down --remove-orphans', {
        cwd: DEMO_CWD,
        env: composeEnv,
        stdio: 'inherit',
        timeout: 2 * 60 * 1000,
      });
    } catch (e) {
      console.error('docker compose down failed:', e);
    }
  }
}
