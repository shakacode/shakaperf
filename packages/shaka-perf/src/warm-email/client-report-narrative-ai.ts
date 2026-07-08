/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
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
// One small batched prompt; 90s is plenty (sonnet on a short prompt) but leave room.
const CLAUDE_TIMEOUT_MS = 90_000;
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
    console.log(`Writing the report's plain-language verdicts via claude (${model})...`);
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('claude', ['-p', prompt, '--model', model], {
        timeout: CLAUDE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { killed?: boolean };
      if (e.code === 'ENOENT') {
        console.warn(chalk.yellow('shaka-perf: `claude` CLI not on PATH - the report uses its built-in verdict copy (no AI rewrite).'));
      } else if (e.killed) {
        console.warn(chalk.yellow(`shaka-perf: AI narrative timed out after ${CLAUDE_TIMEOUT_MS / 1000}s - using the built-in verdict copy.`));
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
