import { ANSI, colorize } from '../helpers/colors';
import type { ColorName } from '../helpers/colors';

describe('ANSI', () => {
  it('defines RESET code', () => {
    expect(ANSI.RESET).toBe('\x1b[0m');
  });

  it('defines RED code', () => {
    expect(ANSI.RED).toBe('\x1b[31m');
  });

  it('defines GREEN code', () => {
    expect(ANSI.GREEN).toBe('\x1b[32m');
  });

  it('defines BLUE code', () => {
    expect(ANSI.BLUE).toBe('\x1b[34m');
  });

  it('defines YELLOW code', () => {
    expect(ANSI.YELLOW).toBe('\x1b[33m');
  });

  it('defines BOLD code', () => {
    expect(ANSI.BOLD).toBe('\x1b[1m');
  });

  it('defines DIM code', () => {
    expect(ANSI.DIM).toBe('\x1b[2m');
  });
});

describe('colorize', () => {
  it('wraps text in red ANSI codes', () => {
    expect(colorize.red('hello')).toBe(`${ANSI.RED}hello${ANSI.RESET}`);
  });

  it('wraps text in green ANSI codes', () => {
    expect(colorize.green('hello')).toBe(`${ANSI.GREEN}hello${ANSI.RESET}`);
  });

  it('wraps text in blue ANSI codes', () => {
    expect(colorize.blue('hello')).toBe(`${ANSI.BLUE}hello${ANSI.RESET}`);
  });

  it('wraps text in yellow ANSI codes', () => {
    expect(colorize.yellow('hello')).toBe(`${ANSI.YELLOW}hello${ANSI.RESET}`);
  });

  it('wraps text in bold ANSI codes', () => {
    expect(colorize.bold('hello')).toBe(`${ANSI.BOLD}hello${ANSI.RESET}`);
  });

  it('wraps text in dim ANSI codes', () => {
    expect(colorize.dim('hello')).toBe(`${ANSI.DIM}hello${ANSI.RESET}`);
  });

  it('handles empty strings', () => {
    expect(colorize.red('')).toBe(`${ANSI.RED}${ANSI.RESET}`);
  });

  it('handles strings with existing ANSI codes', () => {
    const nested = colorize.red(colorize.bold('hello'));
    expect(nested).toBe(`${ANSI.RED}${ANSI.BOLD}hello${ANSI.RESET}${ANSI.RESET}`);
  });
});

describe('ColorName type', () => {
  it('all colorize keys are valid ColorName values', () => {
    const names: ColorName[] = ['red', 'green', 'blue', 'yellow', 'bold', 'dim'];
    for (const name of names) {
      expect(typeof colorize[name]).toBe('function');
    }
  });
});
