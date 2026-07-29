/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * Side-effect-free formatting helpers for the log-prefix column. Lives in
 * its own module so both the parent process (runner, visreg) and forked
 * worker processes can import without pulling in the prefix-source
 * registry or any AsyncLocalStorage initialisation.
 */

export type Group = 'control' | 'experiment';

// Inner bracket width = longest group name + 1 space on each side. Renders
// as `[  control   ]` (5 spaces split 2/3) and `[ experiment ]` (2 spaces
// split 1/1) so the column following the closing bracket lines up across
// rows regardless of which group fired the log line.
const INNER_WIDTH = 'experiment'.length + 2;

function centerPad(text: string, width: number): string {
  const total = Math.max(0, width - text.length);
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + text + ' '.repeat(total - left);
}

export function formatLogPrefix(group: Group): string {
  return `[${centerPad(group, INNER_WIDTH)}]`;
}
