/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * `fn` as a parenthesised expression for `page.evaluate(string)`. A shorthand
 * method's `toString()` (`locate(el) { … }`) is not an expression on its own;
 * prefixing `function` makes it one, as Playwright does for its own arguments.
 */
export function pageFunctionSource(fn: (...args: never[]) => unknown, what: string): string {
  let source = fn.toString().trim();
  if (!isExpression(source)) {
    source = source.startsWith('async ')
      ? `async function ${source.slice('async '.length)}`
      : `function ${source}`;
    if (!isExpression(source)) {
      throw new Error(`${what} cannot be serialized into the page: ${fn.toString().slice(0, 80)}`);
    }
  }
  return `(${source})`;
}

function isExpression(source: string): boolean {
  try {
    new Function(`(${source})`);
    return true;
  } catch {
    return false;
  }
}
