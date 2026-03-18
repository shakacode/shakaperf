import * as fs from 'fs';
import * as path from 'path';

export function findConfigFile(filenames: string[], cwd: string = process.cwd()): string | null {
  for (const filename of filenames) {
    const configPath = path.join(cwd, filename);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}
