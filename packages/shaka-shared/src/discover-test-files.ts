import * as fs from 'fs';
import * as path from 'path';

const AB_TEST_EXTENSIONS = ['.abtest.ts', '.abtest.js'];

/**
 * Recursively discovers test files matching .abtest.ts or .abtest.js patterns.
 * Similar to how Jest discovers test files by walking the directory tree.
 *
 * @param cwd - Directory to search in (defaults to process.cwd())
 * @param pattern - Optional regex pattern to filter discovered files by path (like Jest's testPathPattern)
 * @returns Array of absolute paths to discovered test files
 */
export function discoverTestFiles(cwd: string = process.cwd(), pattern?: string): string[] {
  const files: string[] = [];
  const regex = pattern ? new RegExp(pattern) : null;

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const isAbTest = AB_TEST_EXTENSIONS.some(ext => entry.name.endsWith(ext));
        if (isAbTest) {
          if (!regex || regex.test(fullPath)) {
            files.push(fullPath);
          }
        }
      }
    }
  }

  walk(cwd);
  return files.sort();
}
