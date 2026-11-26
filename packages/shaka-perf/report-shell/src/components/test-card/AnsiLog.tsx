/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Fragment, type CSSProperties, type ReactNode } from 'react';

// Anchor on ESC + `[` so the regex matches actual SGR escape sequences.
// Free-text log content frequently contains `[31m`-like substrings (regex
// literals, screencast call logs, locator selectors) — matching without
// the ESC byte would mistake them for codes and strip them from the
// rendered output.
// eslint-disable-next-line no-control-regex
const SGR_PATTERN = /\x1b\[([\d;]*)m/g;
const RED_CODES = new Set([31, 91]);

interface Style {
  color?: string;
  fontWeight?: 'bold';
  fontStyle?: 'italic';
  textDecoration?: 'underline';
  opacity?: number;
}

const FG_COLORS: Record<number, string> = {
  30: 'var(--ansi-black, #2a2f36)',
  31: 'var(--ansi-red, #e06c75)',
  32: 'var(--ansi-green, #98c379)',
  33: 'var(--ansi-yellow, #e5c07b)',
  34: 'var(--ansi-blue, #61afef)',
  35: 'var(--ansi-magenta, #c678dd)',
  36: 'var(--ansi-cyan, #56b6c2)',
  37: 'var(--ansi-white, #c8ccd4)',
  90: 'var(--ansi-bright-black, #5c6370)',
  91: 'var(--ansi-bright-red, #ff7b85)',
  92: 'var(--ansi-bright-green, #a8d488)',
  93: 'var(--ansi-bright-yellow, #f0d08c)',
  94: 'var(--ansi-bright-blue, #74c0ff)',
  95: 'var(--ansi-bright-magenta, #d68ce8)',
  96: 'var(--ansi-bright-cyan, #6cc6d2)',
  97: 'var(--ansi-bright-white, #ffffff)',
};

interface CodesResult {
  style: Style;
  /** True when any of the input codes was a red FG (31 or 91). */
  touchedRed: boolean;
}

function applyCodes(style: Style, codes: number[]): CodesResult {
  let next: Style = { ...style };
  if (codes.length === 0) return { style: {}, touchedRed: false };
  let touchedRed = false;
  for (const code of codes) {
    if (code === 0) next = {};
    else if (code === 1) next.fontWeight = 'bold';
    else if (code === 2) next.opacity = 0.65;
    else if (code === 3) next.fontStyle = 'italic';
    else if (code === 4) next.textDecoration = 'underline';
    else if (code === 22) { delete next.fontWeight; delete next.opacity; }
    else if (code === 23) delete next.fontStyle;
    else if (code === 24) delete next.textDecoration;
    else if (code === 39) delete next.color;
    else if (FG_COLORS[code]) {
      next.color = FG_COLORS[code];
      if (RED_CODES.has(code)) touchedRed = true;
    }
  }
  return { style: next, touchedRed };
}

function styleToCss(style: Style): CSSProperties | undefined {
  if (Object.keys(style).length === 0) return undefined;
  return style;
}

interface ParsedLine {
  segments: { text: string; style: Style }[];
  /** True when one of the SGR codes encountered on this line was red. */
  hasRed: boolean;
}

function parseAnsiLine(input: string): ParsedLine {
  const segments: { text: string; style: Style }[] = [];
  let style: Style = {};
  let hasRed = false;
  let cursor = 0;
  for (const match of input.matchAll(SGR_PATTERN)) {
    const idx = match.index!;
    if (idx > cursor) {
      segments.push({ text: input.slice(cursor, idx), style });
    }
    const params = match[1].length === 0 ? [0] : match[1].split(';').map(Number);
    const applied = applyCodes(style, params);
    style = applied.style;
    if (applied.touchedRed) hasRed = true;
    cursor = idx + match[0].length;
  }
  if (cursor < input.length) {
    segments.push({ text: input.slice(cursor), style });
  }
  return {
    segments: segments.filter((s) => s.text.length > 0),
    hasRed,
  };
}

/** Renders text containing ANSI SGR escapes as styled spans. */
export function AnsiLog({
  text,
  className,
  errorClassName,
}: {
  text: string;
  className?: string;
  /**
   * Applied to the line wrapper when any SGR on the line was a red FG code
   * (31 or 91). Detection is code-based — not colour-string-based — so
   * renaming a CSS palette variable can't silently stop flagging errors.
   */
  errorClassName?: string;
}) {
  // Split by newlines so each line gets its own wrapper and the error class
  // applies row-by-row. SGR state intentionally resets per line: chalk's
  // own segmented output (`\x1b[31m...\x1b[39m`) always closes within the
  // line, and a leak across `\n` would smear colours across unrelated
  // log entries.
  const lines = text.split('\n');
  return (
    <pre className={className}>
      {lines.map((line, lineIndex) => {
        const { segments, hasRed } = parseAnsiLine(line);
        const content: ReactNode[] = segments.map((seg, segIndex) => (
          <span key={segIndex} style={styleToCss(seg.style)}>{seg.text}</span>
        ));
        return (
          <Fragment key={lineIndex}>
            <span className={hasRed ? errorClassName : undefined}>
              {content.length > 0 ? content : line}
            </span>
            {lineIndex < lines.length - 1 ? '\n' : null}
          </Fragment>
        );
      })}
    </pre>
  );
}

/**
 * First `<X.Ys>` elapsed-tag value found in a log body, or null when none
 * is present (e.g. a single "skipped" sentinel line). The runner stamps
 * every emitted line with this tag — often wrapped in dim SGR codes — so
 * we strip SGR sequences before matching to keep the regex straightforward.
 */
export function firstElapsedSeconds(body: string): number | null {
  const stripped = body.replace(SGR_PATTERN, '');
  const m = stripped.match(/<(\d+(?:\.\d+)?)s>/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
