/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Pure parse of the runner's `{"score":N|null}` stdout line; tolerates stray log
// lines, returns null on anything malformed.
export function parseAccessibilityScoreStdout(stdout: string): number | null {
  try {
    const match = stdout.match(/\{"score":\s*(?:-?\d+(?:\.\d+)?|null)\}/);
    const parsed = JSON.parse(match ? match[0] : stdout.trim()) as { score?: unknown };
    return typeof parsed.score === 'number' && Number.isFinite(parsed.score) ? parsed.score : null;
  } catch {
    return null;
  }
}
