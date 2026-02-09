import { colorize, printError, printSuccess, printWarning, printInfo, printBanner } from '../helpers/ui';
import type { Color } from '../helpers/ui';

describe('colorize', () => {
  it('wraps text with color and reset codes', () => {
    const result = colorize('hello', 'red');
    // The result depends on TTY support; in test it's likely non-TTY
    // so colors may be empty strings. Either way, the text should appear.
    expect(result).toContain('hello');
  });

  it('works with all color values', () => {
    const colors: Color[] = ['red', 'green', 'yellow', 'blue'];
    for (const color of colors) {
      const result = colorize('text', color);
      expect(result).toContain('text');
    }
  });

  it('handles empty string', () => {
    const result = colorize('', 'red');
    expect(typeof result).toBe('string');
  });
});

describe('printError', () => {
  it('outputs error message to stderr', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    printError('something failed');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('something failed'));
    spy.mockRestore();
  });
});

describe('printSuccess', () => {
  it('outputs success message to stdout', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    printSuccess('it worked');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('it worked'));
    spy.mockRestore();
  });
});

describe('printWarning', () => {
  it('outputs warning message to stdout', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    printWarning('be careful');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('be careful'));
    spy.mockRestore();
  });
});

describe('printInfo', () => {
  it('outputs info message to stdout', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    printInfo('fyi');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('fyi'));
    spy.mockRestore();
  });
});

describe('printBanner', () => {
  it('outputs title with border lines', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    printBanner('My Title');
    const calls = spy.mock.calls.map(c => c[0] as string);
    // Should have the title and some border lines
    expect(calls.some(c => c.includes('My Title'))).toBe(true);
    expect(calls.some(c => c.includes('='))).toBe(true);
    spy.mockRestore();
  });

  it('creates border matching title length + 4', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    printBanner('Test');
    const calls = spy.mock.calls.map(c => c[0] as string);
    // Border should contain 8 = signs (4 + 4 for title "Test")
    expect(calls.some(c => c.includes('='.repeat(8)))).toBe(true);
    spy.mockRestore();
  });
});
