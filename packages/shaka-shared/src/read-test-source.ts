import * as fs from 'fs';

/**
 * Reads the source file at `file` and returns the verbatim text of the
 * `abTest(...)` call that starts at (or just before) `line`. Returns null
 * if the file cannot be read or the call cannot be located.
 *
 * Walks forward counting parentheses until balanced, so multi-line argument
 * objects and arrow-function bodies are captured as written.
 */
export function readTestSource(file: string | null, line: number | null): string | null {
  if (!file || !line) return null;

  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  const lines = text.split('\n');
  // Lines are 1-indexed in stack traces.
  const startIdx = findCallStart(lines, line - 1);
  if (startIdx == null) return null;

  let depth = 0;
  let endIdx: number | null = null;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '(') {
        depth++;
        started = true;
      } else if (ch === ')') {
        depth--;
        if (started && depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx != null) break;
  }

  if (endIdx == null) return null;
  return lines.slice(startIdx, endIdx + 1).join('\n');
}

function findCallStart(lines: string[], hint: number): number | null {
  // The stack trace points at the line where `abTest(` opens, but if the
  // identifier and `(` are split across lines we may need to walk back one.
  for (let i = Math.min(hint, lines.length - 1); i >= Math.max(0, hint - 4); i--) {
    if (/\babTest\s*\(/.test(lines[i])) return i;
  }
  // Fallback: assume the hint line is correct.
  return Math.min(hint, lines.length - 1);
}
