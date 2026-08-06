/*
 * Copyright (c) 2026 ShakaCode LLC.
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

// What each test file registered, captured the one time this process imported
// it. Every loader evaluates a module once and serves the cache afterwards, and
// none can be talked out of it (see loadModule) — so a second import registers
// nothing and THIS map, not the global registry, is the durable record. It is
// also what lets the compare pipeline's interleaved per-unit loads (file A,
// then B, then A again) keep returning A's tests.
const registrationsByFile = new Map<string, AbTestDefinition[]>();

/**
 * `abTest()` captures its call site from a stack frame, which under ESM is a
 * `file://` URL. Everything downstream compares `test.file` against filesystem
 * paths, so normalize once, here, at the boundary.
 */
export function normalizeTestFile(test: AbTestDefinition): AbTestDefinition {
  if (!test.file?.startsWith('file:')) return test;
  return { ...test, file: fileURLToPath(test.file) };
}

/**
 * Everything `absolutePath` registers, imported at most once per process.
 * Includes registrations a module it imports makes transitively — the registry
 * is cleared first, so whatever lands during the import is this file's.
 */
async function registrationsFor(absolutePath: string): Promise<AbTestDefinition[]> {
  const remembered = registrationsByFile.get(absolutePath);
  if (remembered) return remembered;

  clearRegistry();
  await loadTestFile(absolutePath);
  const registered = getRegisteredTests().map(normalizeTestFile);
  registrationsByFile.set(absolutePath, registered);
  return registered;
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

// A first load mutates the process-global abTest registry (clear → import →
// read). Concurrent callers — the compare pipeline runs one visreg engine
// invocation per unit on a parallel pool, each calling loadTests — would
// interleave inside the awaited import, and every caller's read would pick up
// the union of everyone's registrations, duplicating each test (and its
// comparisons, report entries, and thumbnails). Serialize the critical section
// instead. Only first loads contend; once a file is remembered, the call is a
// map lookup.
let loadTestsLock: Promise<unknown> = Promise.resolve();

/**
 * Discovers or loads test files and returns the tests they registered.
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

  let loadedFiles: string[];
  if (filterAsFile) {
    loadedFiles = [filterAsFile];
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
  }

  // Only the LOADED files' tests are returned. Returning tests from files this
  // call didn't ask for would turn an accurate "No tests registered" error into
  // a baffling downstream one ("No tests matched filter"), or worse, silently
  // run the wrong tests.
  let tests: AbTestDefinition[] = [];
  for (const testFile of loadedFiles) {
    tests.push(...await registrationsFor(path.resolve(testFile)));
  }

  // Leave the registry holding exactly what this call selected, so anything
  // reading it directly sees the same set the caller got.
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
