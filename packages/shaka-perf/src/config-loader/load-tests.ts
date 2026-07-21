/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { clearRegistry, getRegisteredTests, restoreRegistry, testRunsForType, TestType } from 'shaka-shared';
import type { AbTestDefinition } from 'shaka-shared';
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
  testType?: TestType;
  log?: (message: string) => void;
}

const ABTEST_FILE_REGEX = /\.abtest\.(ts|js)$/;

// Every registration ever seen in this process, keyed by the file it came
// from. Re-importing an already-loaded module is a no-op (Node's ESM cache —
// and on newer Node even loadTestFile's ?cache-bust query no longer forces
// re-execution), so after a file's first load this map is the only source of
// its tests. Keeping ALL files here (not just the previous load's) is what
// lets interleaved per-test loads (file A, then B, then A again — the
// compare pipeline's per-unit pattern) keep working.
const registrationsByFile = new Map<string, AbTestDefinition[]>();

function normalizeTestFile(test: AbTestDefinition): AbTestDefinition {
  if (!test.file?.startsWith('file:')) return test;
  return { ...test, file: fileURLToPath(test.file) };
}

function rememberRegistrations(tests: AbTestDefinition[]): void {
  const byFile = new Map<string, AbTestDefinition[]>();
  for (const candidate of tests) {
    const test = normalizeTestFile(candidate);
    if (test.file == null) continue;
    const key = path.resolve(test.file);
    const list = byFile.get(key);
    if (list) {
      list.push(test);
    } else {
      byFile.set(key, [test]);
    }
  }
  for (const [file, list] of byFile) {
    registrationsByFile.set(file, list);
  }
}

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

// loadTests mutates the process-global abTest registry (clear → import →
// read). Concurrent callers — the compare pipeline runs one visreg engine
// invocation per unit on a parallel pool, each calling loadTests — interleave
// inside the awaited import and every caller reads the union of everyone's
// registrations, duplicating each test (and its comparisons, report entries,
// and thumbnails). Serialize the whole critical section instead.
let loadTestsLock: Promise<unknown> = Promise.resolve();

/**
 * Clears the registry, discovers or loads test files, and returns the registered tests.
 * Throws if no files are found or no tests are registered.
 * Safe to call concurrently: calls are serialized (see loadTestsLock).
 */
export function loadTests(options: LoadTestsOptions = {}): Promise<AbTestDefinition[]> {
  const result = loadTestsLock.then(() => loadTestsExclusive(options));
  loadTestsLock = result.catch(() => undefined);
  return result;
}

async function loadTestsExclusive(options: LoadTestsOptions): Promise<AbTestDefinition[]> {
  const { testPathPattern, filter, testType, log } = options;

  const filterAsFile = filter ? resolveFilterAsTestFile(filter) : null;

  // Remember what's already registered (a prior loadTests() call, or direct
  // abTest() calls outside any test file) before clearing — if re-import is
  // a no-op, the remembered registrations are all we have.
  const priorRegistry = getRegisteredTests().map(normalizeTestFile);
  rememberRegistrations(priorRegistry);
  clearRegistry();

  let loadedFiles: string[];
  if (filterAsFile) {
    loadedFiles = [filterAsFile];
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
    loadedFiles = discovered;
    for (const testFile of discovered) {
      await loadTestFile(testFile);
    }
  }

  // A file that actually re-executed just overwrote its map entry with fresh
  // registrations; a file whose re-import was a no-op contributes whatever
  // was remembered from its first load. Only the LOADED files' tests are
  // returned — restoring tests from other files would turn an accurate
  // "No tests registered" error into a baffling downstream one ("No tests
  // matched filter"), or worse, silently run the wrong tests.
  const fresh = getRegisteredTests().map(normalizeTestFile);
  rememberRegistrations(fresh);
  const loadedFileSet = new Set(loadedFiles.map((file) => path.resolve(file)));
  let tests = [
    ...loadedFiles.flatMap((file) => registrationsByFile.get(path.resolve(file)) ?? []),
    // Fresh registrations not attributable to a loaded file: tests whose
    // call-site capture failed (file == null) or that a loaded file
    // registered transitively from another module.
    ...fresh.filter((test) => test.file == null || !loadedFileSet.has(path.resolve(test.file))),
  ];
  // Prior registrations without a file (call-site capture failed) can't be
  // attributed to any loaded file — salvage those when the load produced
  // nothing.
  if (tests.length === 0) {
    tests = priorRegistry.filter((test) => test.file == null);
  }
  restoreRegistry(tests);
  if (tests.length === 0) {
    const source = filterAsFile ?? 'discovered files';
    throw new Error(`No tests registered in ${source}. Did you call abTest()?`);
  }

  if (testType) {
    const totalCount = tests.length;
    tests = tests.filter(t => testRunsForType(t, testType));
    if (log && tests.length !== totalCount) {
      log(`Selected ${tests.length} of ${totalCount} test(s) for test type "${testType}".`);
    }
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
