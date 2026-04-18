import { clearRegistry, getRegisteredTests, restoreRegistry } from './ab-test-registry';
import type { AbTestDefinition } from './ab-test-registry';
import { loadTestFile } from './load-test-file';
import { findTestFiles } from './discover-test-files';

export interface LoadTestsOptions {
  testFile?: string;
  testPathPattern?: string;
  filter?: string;
  log?: (message: string) => void;
}

/**
 * Clears the registry, discovers or loads test files, and returns the registered tests.
 * Throws if no files are found or no tests are registered.
 */
export async function loadTests(options: LoadTestsOptions = {}): Promise<AbTestDefinition[]> {
  const { testFile, testPathPattern, filter, log } = options;

  // Capture what's already registered so we can restore if re-import is a
  // no-op (Node's ESM cache — and tsx's tsImport — won't re-execute a module
  // that has already been loaded in the same process, so repeated loadTests()
  // calls would otherwise return 0 tests).
  const priorRegistry = getRegisteredTests();
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

  let tests = getRegisteredTests();
  if (tests.length === 0 && priorRegistry.length > 0) {
    restoreRegistry(priorRegistry);
    tests = getRegisteredTests();
  }
  if (tests.length === 0) {
    const source = testFile || 'discovered files';
    throw new Error(`No tests registered in ${source}. Did you call abTest()?`);
  }

  if (filter) {
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
