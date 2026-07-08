/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';

import { writeClientReport } from './client-report';
import { claudeCaptionRefiner } from './caption-ai';
import { claudeA11ySummarizer } from './a11y-summary-ai';
import { claudeAgentSummarizer } from './agent-ready-summary-ai';
import { claudeNarrator } from './client-report-narrative-ai';
import type { NarrativeSummarizer } from './client-report-narrative';

export const CLIENT_REPORT_FILENAME = 'client-report.html';

// Shared narrative option for every client-report-producing command. The report
// has one renderer now; the AI narrative pass is on unless --no-ai-narrative.
export function clientReportNarrativeOpts(opts: { aiNarrative?: boolean }): { narrate?: NarrativeSummarizer } {
  return opts.aiNarrative !== false ? { narrate: claudeNarrator() } : {};
}

// Kept identical across client-report, warm-email, and cold-email.
export function addClientReportNarrativeOption(cmd: Command): Command {
  return cmd.option('--no-ai-narrative', 'Skip the AI rewrite of the report verdict copy (the built-in deterministic copy is always present)');
}

// `shaka-perf client-report` - render the clean, client-facing report from a
// saved audit-results dir. The warm-email/cold-email commands run this too (so
// the email has something to attach); it also stands alone. See ./client-report.ts.
export function createClientReportCommand(): Command {
  const cmd = new Command('client-report')
    .description('Render a clean, client-facing site-health report (filmstrips + plain language) from a saved audit-results dir')
    .requiredOption('--results <dir>', 'Path to a saved audit-results directory (must contain report.json)')
    .option('--out <path>', `Output path for the HTML (default: <results>/${CLIENT_REPORT_FILENAME})`)
    .option('--no-ai-captions', 'Skip the AI rewrite of the on-video captions (the built-in deterministic captions are always present)')
    .option('--no-ai-a11y', 'Skip the AI plain-language accessibility summaries (the cards fall back to a plain-language issue list)')
    .option('--no-ai-agent', 'Skip the AI plain-language Agent Ready summaries (the cards fall back to the plain findings list)');
  return addClientReportNarrativeOption(cmd)
    .action(async function (this: Command) {
      const opts = this.opts();
      const resultsDir = path.resolve(opts.results);
      const reportJson = path.join(resultsDir, 'report.json');
      if (!fs.existsSync(reportJson)) {
        console.error(`No report.json in ${resultsDir}. Run \`shaka-perf audit\` there first.`);
        process.exit(1);
      }
      const outPath = opts.out ? path.resolve(opts.out) : path.join(resultsDir, CLIENT_REPORT_FILENAME);
      const pages = await writeClientReport(resultsDir, outPath, {
        refineCaptions: opts.aiCaptions === false ? undefined : claudeCaptionRefiner(),
        summarizeA11y: opts.aiA11y === false ? undefined : claudeA11ySummarizer(),
        summarizeAgent: opts.aiAgent === false ? undefined : claudeAgentSummarizer(),
        ...clientReportNarrativeOpts(opts),
      });
      console.log(`Wrote client-facing report for ${pages} page(s): ${outPath}`);
    });
}
