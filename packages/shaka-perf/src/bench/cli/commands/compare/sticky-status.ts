// CSI / OSC ANSI sequence matcher. Built via new RegExp with \uXXXX
// escapes so the source has no raw control bytes.
const ANSI_REGEX = new RegExp(
  '[\\u001b\\u009b][[\\]()#;?]*' +
  '(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007)' +
  '|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
  'g',
);
const stripAnsi = (text: string): string => text.replace(ANSI_REGEX, '');

export interface StickyStatus {
  set(text: string): void;
  dispose(): void;
}

/**
 * Pin a single status line to the bottom of the terminal. Subsequent writes
 * to stdout / stderr from anywhere in the process scroll above it: we patch
 * `process.stdout.write` and `process.stderr.write` to clear the sticky line
 * before each write and re-render it after, so the line stays visible across
 * concurrent log activity (parent banners, forked-worker output piped through
 * teeLinePrefixed, child process stderr, etc).
 *
 * Non-TTY (CI, piped output): no-op — every operation is a pass-through and
 * stdout / stderr aren't patched, so engine-output.log captures unmodified
 * output.
 *
 * Constraints:
 *   - Assumes line-terminated writes. A bare `process.stdout.write('partial')`
 *     leaves the cursor mid-line and the sticky re-render will overlay it.
 *     `console.log` (line-buffered) and teeLinePrefixed (per-line) both honor
 *     this; that covers all of shaka-perf's hot paths.
 *   - Only one StickyStatus may be attached per process at a time.
 */
export function attachStickyStatus(): StickyStatus {
  if (!process.stdout.isTTY) {
    return { set: () => {}, dispose: () => {} };
  }

  let current = '';
  let active = true;

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  // \r        — cursor to column 0
  // \x1b[2K   — erase entire current row
  // \x1b[1A   — cursor up one row
  function clearSticky(): void {
    if (!current) return;
    const cols = process.stdout.columns || Number.POSITIVE_INFINITY;
    const visibleLen = stripAnsi(current).length;
    const wrappedRows = Math.max(0, Math.ceil(visibleLen / cols) - 1);
    let seq = '\r\u001b[2K';
    for (let i = 0; i < wrappedRows; i++) seq += '\u001b[1A\u001b[2K';
    origStdoutWrite(seq);
  }

  function renderSticky(): void {
    if (!current) return;
    origStdoutWrite(current);
  }

  function wrap(orig: typeof origStdoutWrite): typeof origStdoutWrite {
    return ((chunk: unknown, ...args: unknown[]): boolean => {
      if (!active) return (orig as (...a: unknown[]) => boolean)(chunk, ...args);
      clearSticky();
      const result = (orig as (...a: unknown[]) => boolean)(chunk, ...args);
      renderSticky();
      return result;
    }) as typeof origStdoutWrite;
  }

  process.stdout.write = wrap(origStdoutWrite);
  process.stderr.write = wrap(origStderrWrite);

  return {
    set(text: string): void {
      if (!active || text === current) return;
      clearSticky();
      current = text;
      renderSticky();
    },
    dispose(): void {
      if (!active) return;
      clearSticky();
      current = '';
      active = false;
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
    },
  };
}
