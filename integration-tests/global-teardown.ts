import * as fs from 'fs';
import { DEMO_CWD, loud, run } from './helpers';

export default async function globalTeardown() {
  if (process.env.SKIP_TEARDOWN === '1') {
    console.log('Skipping teardown (SKIP_TEARDOWN=1)');
    return;
  }

  if (fs.existsSync(DEMO_CWD)) {
    try {
      loud('Stopping containers');
      run('yarn shaka-perf twin-servers stop-containers', { timeout: 2 * 60 * 1000 });
    } catch (e) {
      console.error('stop-containers failed:', e);
    }
  }
}
