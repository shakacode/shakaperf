/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';

export function pairedBenchmarkParallelism(requestedParallelism: number): number {
  return Math.max(1, Math.floor(requestedParallelism / 2));
}

/** A `--filter` value that matches this one name and nothing else. */
export function exactTestNameFilter(testName: string): string {
  return `^${escapeRegex(testName)}$`;
}

export function testPathPatternForSingleTest(test: AbTestDefinition, fallback?: string): string | undefined {
  return test.file ? escapeRegex(test.file) : fallback;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
