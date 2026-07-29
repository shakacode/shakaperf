/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Readable } from 'node:stream';

// The dynamic linker prints lines like
//   ffmpeg: /home/linuxbrew/.linuxbrew/lib/libncursesw.so.6: no version information available (required by /lib/x86_64-linux-gnu/libcaca.so.0)
// when one of ffmpeg's transitive libraries is shadowed by an older copy
// elsewhere on the loader path (commonly linuxbrew vs. system libs).
// It's harmless — the loader still resolves the symbols — but it spams
// stderr every time we shell out. The line shape comes from glibc's
// `_dl_warn`, so any prefix process name reproduces the same pattern.
const LINKER_VERSION_WARNING_RE = /^[^:]+:\s.+:\s+no version information available\b/;

/**
 * Stream filter for an ffmpeg child's piped stderr. Drops the glibc
 * loader's "no version information available" warning lines and writes
 * everything else through to the parent's stderr unchanged (no
 * re-prefixing, no buffering past line boundaries). Use after
 * `spawn(..., { stdio: ['ignore', 'ignore', 'pipe'] })`.
 */
export function pipeAndFilterStderr(stream: Readable): void {
  stream.setEncoding('utf8');
  let buf = '';
  const flushLine = (line: string): void => {
    if (LINKER_VERSION_WARNING_RE.test(line)) return;
    process.stderr.write(`${line}\n`);
  };
  stream.on('data', (chunk: string) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      flushLine(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  });
  stream.on('end', () => {
    if (!buf) return;
    if (LINKER_VERSION_WARNING_RE.test(buf)) return;
    process.stderr.write(buf);
  });
}
