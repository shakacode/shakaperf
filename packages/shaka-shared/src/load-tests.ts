import { clearRegistry, getRegisteredTests } from './ab-test-registry';
import type { AbTestDefinition } from './ab-test-registry';
import { loadTestFile } from './load-test-file';
import { findTestFiles } from './discover-test-files';

export interface LoadTestsOptions {
  testFile?: string;
  testPathPattern?: string;
  log?: (message: string) => void;
}

/**
 * Clears the registry, discovers or loads test files, and returns the registered tests.
 * Throws if no files are found or no tests are registered.
 */
export async function loadTests(options: LoadTestsOptions = {}): Promise<AbTestDefinition[]> {
  const { testFile, testPathPattern, log } = options;

  clearRegistry();

  if (testFile) {
    await loadTestFile(testFile);
  } else {
    const discovered = findTestFiles({ testPathPattern });
    if (discovered.length === 0) {
      const hint = testPathPattern ? ` matching pattern "${testPathPattern}"` : '';
      throw new Error(`No .abtest.ts or .abtest.js files found${hint}. Use --testFile to specify a file directly.`);
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

  const tests = getRegisteredTests();
  if (tests.length === 0) {
    const source = testFile || 'discovered files';
    throw new Error(`No tests registered in ${source}. Did you call abTest()?`);
  }

  return tests;
}
