import * as fs from 'fs';
import * as path from 'path';
import { clearRegistry, getRegisteredTests, restoreRegistry } from './ab-test-registry';
import type { AbTestDefinition } from './ab-test-registry';
import { loadTestFile } from './load-test-file';
import { findTestFiles } from './discover-test-files';

export interface LoadTestsOptions {
  testPathPattern?: string;
  /**
   * Either a regex/substring against test names (comma-separated for multiple)
   * or a path to a single .abtest.ts / .abtest.js file. When the value resolves
   * to an existing abtest file, discovery is skipped and only that file is loaded.
   */
  filter?: string;
  log?: (message: string) => void;
}

const ABTEST_FILE_REGEX = /\.abtest\.(ts|js)$/;

function resolveFilterAsTestFile(filter: string): string | null {
  if (!ABTEST_FILE_REGEX.test(filter)) return null;
  const resolved = path.resolve(filter);
  try {
    if (fs.statSync(resolved).isFile()) return resolved;
  } catch {
    return null;
  }
  return null;
}

/**
 * Clears the registry, discovers or loads test files, and returns the registered tests.
 * Throws if no files are found or no tests are registered.
 */
export async function loadTests(options: LoadTestsOptions = {}): Promise<AbTestDefinition[]> {
  const { testPathPattern, filter, log } = options;

  const filterAsFile = filter ? resolveFilterAsTestFile(filter) : null;

  // Capture what's already registered so we can restore if re-import is a
  // no-op (Node's ESM cache — and tsx's tsImport — won't re-execute a module
  // that has already been loaded in the same process, so repeated loadTests()
  // calls would otherwise return 0 tests).
  const priorRegistry = getRegisteredTests();
  clearRegistry();

  if (filterAsFile) {
    await loadTestFile(filterAsFile);
  } else {
    const discovered = findTestFiles({ testPathPattern });
    if (discovered.length === 0) {
      const hint = testPathPattern ? ` matching pattern "${testPathPattern}"` : '';
      throw new Error(
        `No .abtest.ts or .abtest.js files found${hint}. Pass a file path to --filter to target one directly.`,
      );
    }
    if (log) {
      log(`Discovered ${discovered.length} test file(s):`);
      for (const testFile of discovered) {
        log(`  ${testFile}`);
      }
    }
    for (const testFile of discovered) {
      await loadTestFile(testFile);
    }
  }

  let tests = getRegisteredTests();
  if (tests.length === 0 && priorRegistry.length > 0) {
    restoreRegistry(priorRegistry);
    tests = getRegisteredTests();
  }
  if (tests.length === 0) {
    const source = filterAsFile ?? 'discovered files';
    throw new Error(`No tests registered in ${source}. Did you call abTest()?`);
  }

  if (filter && !filterAsFile) {
    const totalCount = tests.length;
    const patterns = filter.split(',');
    tests = tests.filter(t => patterns.some(p => new RegExp(p).test(t.name)));
    if (log) {
      log(`Selected ${tests.length} of ${totalCount} test(s).`);
    }
    if (tests.length === 0) {
      throw new Error(`No tests matched filter "${filter}".`);
    }
  }

  return tests;
}
