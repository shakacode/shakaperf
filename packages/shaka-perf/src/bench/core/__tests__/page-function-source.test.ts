/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { pageFunctionSource } from '../page-function-source';

// Each result is evaluated the way the page would evaluate it: as an
// expression that must yield a callable.
const evaluate = (source: string): (...args: unknown[]) => unknown =>
  new Function(`return ${source}`)() as (...args: unknown[]) => unknown;

describe('pageFunctionSource', () => {
  it('passes an arrow function through as an expression', () => {
    const source = pageFunctionSource((el: { id: string }) => el.id, 'locate');
    expect(evaluate(source)({ id: 'x' })).toBe('x');
  });

  it('passes a function declaration through', () => {
    function locate(el: { id: string }): string { return el.id; }
    expect(evaluate(pageFunctionSource(locate, 'locate'))({ id: 'y' })).toBe('y');
  });

  it('makes a shorthand method callable, the way Playwright does', () => {
    const plugin = { locate(el: { id: string }) { return el.id; } };
    expect(evaluate(pageFunctionSource(plugin.locate, 'locate'))({ id: 'z' })).toBe('z');
  });

  it('makes an async shorthand method callable', async () => {
    const plugin = { async locate(el: { id: string }) { return el.id; } };
    await expect(evaluate(pageFunctionSource(plugin.locate, 'locate'))({ id: 'w' })).resolves.toBe('w');
  });

  it('names the option in the error when nothing parses', () => {
    const broken = { toString: () => 'not javascript at all (' } as unknown as () => unknown;
    expect(() => pageFunctionSource(broken, 'screenshotCoveragePlugin "x".locate'))
      .toThrow(/screenshotCoveragePlugin "x"\.locate cannot be serialized/);
  });
});
