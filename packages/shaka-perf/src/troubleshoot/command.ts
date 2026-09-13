/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { exactTestNameFilter } from '../compare/stages/shared/runtime';
import { shellQuote } from '../shell-command';

/**
 * The command that re-runs one test at one viewport with its browsers left
 * open. Audits and comparisons both point at it: the tests are the same
 * `.abtest.ts` definitions, and `troubleshoot` runs whichever of visreg/perf a
 * test declares. Shared so the two reports can never drift apart. `--filter`
 * is a regex, so the name is anchored and escaped, not just shell-quoted.
 */
export function troubleshootCommandFor(testName: string, viewportLabel: string): string {
  return `shaka-perf troubleshoot --filter ${shellQuote(exactTestNameFilter(testName))} --viewport ${viewportLabel}`;
}
