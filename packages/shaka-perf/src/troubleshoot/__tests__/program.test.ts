/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Command } from 'commander';
import { createTroubleshootCommand, parseHeaded } from '../program';

async function command(): Promise<Command> {
  const cmd = await createTroubleshootCommand();
  return cmd.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} });
}

describe('createTroubleshootCommand', () => {
  it('refuses to run without --filter, the one-test constraint', async () => {
    await expect(
      (await command()).parseAsync(['--viewport', 'desktop'], { from: 'user' }),
    ).rejects.toThrow(/--filter/);
  });

  it('refuses to run without --viewport, the one-viewport constraint', async () => {
    await expect(
      (await command()).parseAsync(['--filter', 'Cart'], { from: 'user' }),
    ).rejects.toThrow(/--viewport/);
  });

  it('offers no way to widen the run past what keep-open can survive', async () => {
    const longs = (await command()).options.map((o) => o.long);

    // Each would contradict the command or multiply the parked windows.
    expect(longs).not.toContain('--burn');
    expect(longs).not.toContain('--report-only');
    expect(longs).not.toContain('--skip-report');
  });

  it('shows the browsers by default — that is the whole command', async () => {
    const cmd = await command();
    const longs = cmd.options.map((o) => o.long);
    expect(longs).toContain('--headed');
    expect(cmd.options.find((o) => o.long === '--headed')?.defaultValue).toBe(true);
    // One flag covers both directions, so there is no second spelling of it.
    expect(longs).not.toContain('--no-headed');
    expect(longs).not.toContain('--headless');
  });

  it('reads --headed both ways off the one flag', () => {
    expect(parseHeaded(true)).toBe(true);        // bare --headed
    expect(parseHeaded('false')).toBe(false);    // --headed=false
    expect(parseHeaded('0')).toBe(false);
    expect(parseHeaded('NO')).toBe(false);
    expect(parseHeaded('true')).toBe(true);
    // A typo shows you the browsers rather than silently hiding them.
    expect(parseHeaded('flase')).toBe(true);
  });

  it('defaults --categories to the two it supports', async () => {
    const categories = (await command()).options.find((o) => o.long === '--categories');
    expect(categories?.defaultValue).toBe('visreg,perf');
  });
});
