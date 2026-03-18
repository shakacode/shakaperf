import * as fs from 'fs';
import * as path from 'path';

const ABTEST_FILE_REGEX = /\.abtest\.(ts|js)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

function scanDir(dir: string, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, results);
    } else if (entry.isFile() && ABTEST_FILE_REGEX.test(entry.name)) {
      results.push(fullPath);
    }
  }
}

export interface FindTestFilesOptions {
  cwd?: string;
  testPathPattern?: string;
}

/**
 * Discovers all *.abtest.ts and *.abtest.js files recursively from cwd,
 * optionally filtered by a regex pattern (like Jest's --testPathPattern).
 */
export function findTestFiles(options: FindTestFilesOptions = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const results: string[] = [];
  scanDir(cwd, results);
  results.sort();

  if (options.testPathPattern) {
    const regex = new RegExp(options.testPathPattern);
    return results.filter(f => regex.test(f));
  }

  return results;
}
