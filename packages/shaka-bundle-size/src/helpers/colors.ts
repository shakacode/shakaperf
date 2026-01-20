/**
 * ANSI color codes for terminal output.
 */
export const ANSI = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  BLUE: '\x1b[34m',
  YELLOW: '\x1b[33m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
} as const;

/**
 * Wraps text with ANSI color codes.
 */
export const colorize = {
  red: (text: string): string => `${ANSI.RED}${text}${ANSI.RESET}`,
  green: (text: string): string => `${ANSI.GREEN}${text}${ANSI.RESET}`,
  blue: (text: string): string => `${ANSI.BLUE}${text}${ANSI.RESET}`,
  yellow: (text: string): string => `${ANSI.YELLOW}${text}${ANSI.RESET}`,
  bold: (text: string): string => `${ANSI.BOLD}${text}${ANSI.RESET}`,
  dim: (text: string): string => `${ANSI.DIM}${text}${ANSI.RESET}`,
};

export type ColorName = keyof typeof colorize;
