import * as fs from 'fs';
import { DEMO_CWD, loud, run } from './helpers';

export default async function globalTeardown() {
  if (fs.existsSync(DEMO_CWD)) {
    try {
      loud('Stopping containers');
      run('yarn shaka-twin-servers stop-containers', { timeout: 2 * 60 * 1000 });
    } catch (e) {
      console.error('stop-containers failed:', e);
    }
  }
}
