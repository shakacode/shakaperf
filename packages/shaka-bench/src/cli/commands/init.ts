import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_LH_CONFIG } from '../../core/create-lighthouse-benchmark';

const CONFIG_FILENAME = 'bench.config.ts';

function buildConfigTemplate(): string {
  const json = JSON.stringify(DEFAULT_LH_CONFIG, null, 2);
  // Indent the config body by 2 spaces (inside defineConfig call)
  const indented = json.split('\n').join('\n  ');
  return `import { defineConfig } from 'shaka-bench';

export default defineConfig(${indented});
`;
}

export async function runInit(): Promise<void> {
  const configPath = path.join(process.cwd(), CONFIG_FILENAME);

  if (fs.existsSync(configPath)) {
    console.warn(`${CONFIG_FILENAME} already exists. Skipping.`);
    return;
  }

  fs.writeFileSync(configPath, buildConfigTemplate(), 'utf8');
  console.log(`Created ${CONFIG_FILENAME}`);
}
