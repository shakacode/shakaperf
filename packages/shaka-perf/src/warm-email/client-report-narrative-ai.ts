/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';

import {
  buildNarrativePrompt,
  parseNarrativeResponse,
  type NarrativeFacts,
  type NarrativeOverlay,
  type NarrativeSummarizer,
} from './client-report-narrative';

const execFileAsync = promisify(execFile);
const DEFAULT_NARRATIVE_TIMEOUT_MS = 90_000;
export function resolveNarrativeTimeoutMs(): number {
  const raw = process.env.SHAKAPERF_NARRATIVE_TIMEOUT_MS;
  const parsed = Number(raw);
  const valid = Number.isFinite(parsed) && parsed > 0;
  if (raw && !valid) {
    console.warn(`shaka-perf: ignoring SHAKAPERF_NARRATIVE_TIMEOUT_MS="${raw}" (expected a positive number of milliseconds)`);
  }
  return valid ? parsed : DEFAULT_NARRATIVE_TIMEOUT_MS;
}
const MAX_PROMPT_BYTES = 60_000;

// Rewrites the client report's verdict copy (bottom line + per-tab verdicts) into
// tighter, site-specific prose via one `claude -p` call. Best-effort like the
// a11y/agent summary passes: any failure returns null and the caller keeps the
// deterministic copy. Default sonnet (haiku goes vague on this short, high-stakes
// client-facing copy).
export function claudeNarrator(model = 'sonnet'): NarrativeSummarizer {
  return async (facts: NarrativeFacts): Promise<NarrativeOverlay | null> => {
    const prompt = buildNarrativePrompt(facts);
    if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
      console.warn(chalk.yellow('shaka-perf: narrative prompt too large - using the built-in verdict copy.'));
      return null;
    }
    const timeoutMs = resolveNarrativeTimeoutMs();
    console.log(`Writing the report's plain-language verdicts via claude (${model})...`);
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('claude', ['-p', prompt, '--model', model], {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { killed?: boolean };
      if (e.code === 'ENOENT') {
        console.warn(chalk.yellow('shaka-perf: `claude` CLI not on PATH - the report uses its built-in verdict copy (no AI rewrite).'));
      } else if (e.killed) {
        console.warn(chalk.yellow(`shaka-perf: AI narrative timed out after ${timeoutMs / 1000}s - using the built-in verdict copy.`));
      } else {
        console.warn(chalk.yellow('shaka-perf: AI narrative did not complete - using the built-in verdict copy.'));
      }
      return null;
    }
    const parsed = parseNarrativeResponse(stdout);
    if (!parsed) {
      console.warn(chalk.yellow('shaka-perf: AI narrative output was unusable - using the built-in verdict copy.'));
    } else {
      console.log('Report verdict copy written by AI.');
    }
    return parsed;
  };
}
