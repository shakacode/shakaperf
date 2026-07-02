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

import type { TestContext } from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import type { AuditMetric, AuditResult } from '../audit';
import type { AccessibilityResult } from '../accessibility/types';
import type { AgentReadinessResult } from '../agent_readiness/types';
import { scorePageStructure } from '../../../warm-email/agent-ready-score';
import type { AiSummaryResult } from './stage';

const execFileAsync = promisify(execFile);

// Output hard cap (also instructed in the prompt). 280 not 200: a holistic
// summary needs room for a second clause.
const MAX_SUMMARY_CHARS = 280;
// 120s not 60s: a cold `claude -p` boot can run past a minute.
const CLAUDE_TIMEOUT_MS = 120_000;

/**
 * Hand the audit results to `claude -p` (haiku) for a layperson summary.
 * Performance (`audit`) leads and gates; accessibility and agent-readiness are
 * folded in (via `ctx.readPriorResult`) only when those stages ran. Best-effort:
 * any failure (claude missing/exit/timeout, or a malformed prior result) logs
 * and returns an empty summary - it must never fail the audit.
 */
export async function runAiSummaryStage(ctx: TestContext, pool: WorkerPool): Promise<AiSummaryResult> {
  const audit = ctx.readPriorResult<AuditResult>('audit');
  const metrics = audit?.metrics ?? [];
  if (metrics.length === 0) {
    ctx.logger.log('[ai-summary] no audit metrics available; skipping AI summary.');
    return { summary: '' };
  }

  // Sibling dimensions, present only when their stage ran (e.g. no accessibility
  // under `--categories audit`).
  const a11y = ctx.readPriorResult<AccessibilityResult>('accessibility');
  const agent = ctx.readPriorResult<AgentReadinessResult>('agent-readiness');

  // Inside the best-effort boundary: a malformed/stale prior result could throw
  // here, and that must degrade to an empty summary, not fail the audit.
  let prompt: string;
  try {
    prompt = buildPrompt(metrics, a11y, agent);
  } catch (err) {
    ctx.logger.log(`[ai-summary] prompt build failed, no summary: ${(err as Error).message}`);
    return { summary: '' };
  }
  // Requirement: always log the exact prompt sent to the model.
  ctx.logger.log(`[ai-summary] claude -p (haiku) prompt:\n${prompt}`);

  // Run claude through the pool (STAGE-AUTHORING.md: child processes go through
  // `pool.submit`). Errors are caught INSIDE the task (return a sentinel, don't
  // throw) so a claude failure can't trip the pool's retry/poison path.
  const result = await pool.submit<{ ok: true; stdout: string } | { ok: false; message: string }>(
    async () => {
      try {
        const { stdout } = await execFileAsync('claude', ['-p', prompt, '--model', 'haiku'], {
          timeout: CLAUDE_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        });
        return { ok: true, stdout };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    },
    { key: `${ctx.testAndViewportId}:ai_summary` },
  );

  if (!result.ok) {
    ctx.logger.log(`[ai-summary] claude call failed, no summary: ${result.message}`);
    return { summary: '' };
  }
  const summary = result.stdout
    .trim()
    .replace(/\s+/g, ' ')
    // No em/en dashes in this client-facing copy - normalise to a spaced hyphen.
    .replace(/\s*[—–]\s*/g, ' - ')
    .slice(0, MAX_SUMMARY_CHARS)
    // slice can leave a trailing space; trim so the summary never ends in one.
    .trim();
  ctx.logger.log(`[ai-summary] summary (${summary.length} chars): ${summary}`);
  return { summary };
}

function buildPrompt(
  metrics: readonly AuditMetric[],
  a11y: AccessibilityResult | undefined,
  agent: AgentReadinessResult | undefined,
): string {
  const perf = metrics
    .map((m) => `- ${m.label}: ${m.display}${m.level ? ` (${m.level})` : ''}`)
    .join('\n');

  const sections: string[] = ['PERFORMANCE (the priority - lead with this):', perf];

  const a11yLine = describeAccessibility(a11y);
  if (a11yLine) sections.push('', 'ACCESSIBILITY:', `- ${a11yLine}`);

  const agentLine = describeAgentReadiness(agent);
  if (agentLine) {
    sections.push('', 'AI-AGENT READABILITY (how well AI assistants and answer engines can read the page):', `- ${agentLine}`);
  }

  const extraDims = [a11yLine ? 'accessibility' : null, agentLine ? 'how well AI assistants can read it' : null].filter(
    Boolean,
  ) as string[];
  const multi = extraDims.length > 0;

  const intro = multi
    ? [
        `Below are the measured results for one web page across speed plus ${extraDims.join(' and ')}.`,
        'Speed is the most important: lead with how fast and responsive the page feels.',
        'Then, only where something genuinely stands out, add a brief plain mention of the other area(s).',
      ].join(' ')
    : 'Below are the measured results for one web page. Tell them in everyday words how the page performs and what stands out (e.g. whether it loads quickly and feels responsive, or is slow to show its main content).';

  return [
    'You explain website audit results to someone with zero technical knowledge -',
    'they have never heard of LCP, INP, TBT, CLS, accessibility audits, crawlers, or any web metric.',
    '',
    intro,
    '',
    `Write a SHORT plain-language summary, MAXIMUM ${MAX_SUMMARY_CHARS} characters${multi ? ' (one or two sentences)' : ' (one sentence)'}.`,
    'No metric names, no acronyms, no jargon, no scores out of 100, and use plain hyphens (never long dashes). Output ONLY the summary.',
    '',
    'Measured results:',
    sections.join('\n'),
  ].join('\n');
}

// Plain-language a11y signal from axe violations; gates on serious/critical
// ("major barriers"). Exported for tests.
// SECURITY: no page-derived free text in the return value - it goes verbatim
// into the `claude` prompt.
export function describeAccessibility(a11y: AccessibilityResult | undefined): string | null {
  if (!a11y) return null;
  const violations = a11y.scans.flatMap((s) => s.violations);
  const by = (impact: string) => violations.filter((v) => v.impact === impact).length;
  const critical = by('critical');
  const serious = by('serious');
  const moderate = by('moderate');
  const minor = by('minor');
  const total = a11y.totalViolations;
  if (total === 0) return 'No accessibility problems were found.';
  const major = critical + serious;
  if (major === 0) {
    // axe can leave impact null, so moderate+minor may not sum to total; only
    // show the split when it reconciles.
    const breakdown = moderate + minor === total ? ` (${moderate} moderate, ${minor} minor)` : '';
    return `${total} smaller accessibility issue${total === 1 ? '' : 's'}${breakdown} but no major barriers.`;
  }
  return `${major} major accessibility barrier${major === 1 ? '' : 's'} that can block people using assistive technology, out of ${total} issue${total === 1 ? '' : 's'} total.`;
}

// Plain-language AI-readability signal: reuses scorePageStructure for the same
// bucket the Agent Ready tab shows, plus no-JS coverage. Exported for tests.
// SECURITY: no page-derived free text in the return value - it goes verbatim
// into the `claude` prompt.
export function describeAgentReadiness(agent: AgentReadinessResult | undefined): string | null {
  if (!agent) return null;
  const s = scorePageStructure(agent);
  if (s.rawUnreadable) {
    // Only say "blocked" when the fetch actually looked blocked; a plain fetch
    // failure must not be miscast as bot-blocking.
    return agent.raw.likelyBlocked
      ? 'The page the server sends looks bot-blocked, so AI assistants likely see little of this page.'
      : 'The page the server sends could not be read, so we cannot confirm what AI assistants see of this page.';
  }
  const band =
    s.bucket === 'good'
      ? 'reads well for AI assistants and answer engines'
      : s.bucket === 'fair'
        ? 'is only partly readable for AI assistants and answer engines'
        : 'is hard for AI assistants and answer engines to read';
  // A near-textless page reports coverage 1 (nothing to miss); skip the "100%
  // present" line, which would contradict a low band.
  if (agent.rendered.textWords < 20) {
    return `Page ${band}; it has very little text for AI assistants to read.`;
  }
  const pct = Math.round(s.coverage * 100);
  return `Page ${band}; ${pct}% of its text is already present before JavaScript runs (what non-rendering AI crawlers can see).`;
}
