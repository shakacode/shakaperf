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

export function exactTestNameFilter(test: AbTestDefinition): string {
  return `^${escapeRegex(test.name)}$`;
}

export function testPathPatternForSingleTest(test: AbTestDefinition, fallback?: string): string | undefined {
  return test.file ? escapeRegex(test.file) : fallback;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
