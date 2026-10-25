/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFile } from 'node:child_process';

/** Match the FFmpeg on the caller's current PATH, including vendor release suffixes. */
export async function getFfmpegSyncOption(): Promise<'-fps_mode' | '-vsync'> {
  const version = await new Promise<string>((resolve, reject) => {
    execFile('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
  const match = /^ffmpeg version (?:n)?(\d+)(?=[.\s-])/m.exec(version);
  if (!match) {
    throw new Error(`shaka-perf: cannot determine FFmpeg major version from: ${version.split('\n')[0]}`);
  }
  // Keep the legacy flag through v5; v6+ supports fps_mode, and v9 removed vsync.
  return Number(match[1]) >= 6 ? '-fps_mode' : '-vsync';
}
