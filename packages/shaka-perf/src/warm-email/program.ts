/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';

import { synthesizeSite } from './synthesis';
import { buildPrompt, generateWarmEmail } from './generate';
import { writeClientReport } from './client-report';
import { claudeCaptionRefiner } from './caption-ai';
import { claudeA11ySummarizer } from './a11y-summary-ai';
import { claudeAgentSummarizer } from './agent-ready-summary-ai';
import { CLIENT_REPORT_FILENAME, addClientReportNarrativeOption, clientReportNarrativeOpts } from './client-report-program';
import { polishDraft } from '../email-polish/polish';

// `shaka-perf warm-email` - standalone command (not a pipeline stage). Reads a
// SAVED audit-results directory + a client relationship notes file, synthesizes
// the cross-page perf picture, and asks claude to write a warm outreach email
// draft. See ../../README-warm-email.md for the full flow.
export function createWarmEmailCommand(): Command {
  const cmd = new Command('warm-email')
    .description('Generate a warm outreach email draft from a saved audit-results dir + client notes')
    .requiredOption('--results <dir>', 'Path to a saved audit-results directory (must contain report.json)')
    .requiredOption('--client <path>', 'Path to client relationship notes (yaml/markdown/text, read verbatim into the prompt)')
    .option('--out <path>', 'Output path for the draft markdown (default: <results>/../warm-email-draft.md)')
    .option('--model <model>', 'Claude model for generation', 'sonnet')
    .option('--no-ai-captions', 'Skip the AI rewrite of the on-video captions (the built-in deterministic captions are always present)')
    .option('--no-ai-a11y', 'Skip the AI plain-language accessibility summaries (the cards fall back to a plain-language issue list)')
    .option('--no-ai-agent', 'Skip the AI plain-language Agent Ready summaries (the cards fall back to the plain findings list)')
    .option('--no-polish', 'Skip the built-in critique/revise polish pass')
    .option('--polish-rounds <n>', 'Max critique/revise rounds per panel phase (professionals, then clients; each phase exits early when no high-priority fixes remain)', '3')
    .option('--print-prompt', 'Print the generation prompt to stderr (debugging)', false);
  return addClientReportNarrativeOption(cmd).action(async function (this: Command) {
      const opts = this.opts();
      const resultsDir = path.resolve(opts.results);
      const reportJson = path.join(resultsDir, 'report.json');
      if (!fs.existsSync(reportJson)) {
        console.error(`No report.json in ${resultsDir}. Run \`shaka-perf audit\` there first.`);
        process.exit(1);
      }
      const clientPath = path.resolve(opts.client);
      if (!fs.existsSync(clientPath)) {
        console.error(`Client notes file not found: ${clientPath}`);
        process.exit(1);
      }

      const clientNotes = fs.readFileSync(clientPath, 'utf8');
      const scorecard = synthesizeSite(resultsDir);
      if (scorecard.pageCount === 0) {
        console.error(`No pages in ${reportJson} - nothing to report on (interrupted audit, or wrong --results dir?).`);
        process.exit(1);
      }
      console.log(`Synthesized ${scorecard.pageCount} page(s) for ${scorecard.url || resultsDir}.`);
      if (scorecard.slowestByLcp) {
        const lcp = scorecard.slowestByLcp.metrics['LCP'];
        console.log(`Slowest: ${scorecard.slowestByLcp.startingPath || scorecard.slowestByLcp.name}${lcp ? ` (LCP ${lcp.display})` : ''}`);
      }

      // Generate the client-facing report alongside the email. The operator
      // deploys it to <client>.shakaperf.com and the email links to it; it is
      // written into the results dir so there is something to deploy.
      const clientReportPath = path.join(resultsDir, CLIENT_REPORT_FILENAME);
      const reportPages = await writeClientReport(resultsDir, clientReportPath, {
        refineCaptions: opts.aiCaptions === false ? undefined : claudeCaptionRefiner(),
        summarizeA11y: opts.aiA11y === false ? undefined : claudeA11ySummarizer(),
        summarizeAgent: opts.aiAgent === false ? undefined : claudeAgentSummarizer(),
        ...clientReportNarrativeOpts(opts),
      });
      console.log(`Wrote client-facing report for ${reportPages} page(s): ${clientReportPath}`);

      const outPath = opts.out
        ? path.resolve(opts.out)
        : path.join(path.dirname(resultsDir), 'warm-email-draft.md');
      // Print before the claude call: the prompt is the debugging tool for
      // exactly the case where that call fails or hangs.
      if (opts.printPrompt) {
        console.error(`\n--- prompt ---\n${buildPrompt(scorecard, clientNotes)}\n--- end prompt ---\n`);
      }
      console.log(`Generating warm email via claude (${opts.model})...`);
      const { draft: rawDraft, prompt } = await generateWarmEmail(scorecard, clientNotes, {
        model: opts.model,
      });

      // Built-in quality pass mirroring the operator-side polish-loop: two
      // panel phases (3 professional critics, then 3 client critics; one
      // sub-agent call per critic), rounds alternate Opus and Sonnet until no
      // high-priority fixes remain, then one cross-vendor codex pass. In the
      // tool (not an operator-side skill) so every run gets the identical
      // pipeline.
      let draft = rawDraft;
      if (opts.polish) {
        // The polish pass improves a draft that already exists; no failure in
        // it may cost the draft itself. Known failures degrade inside
        // polishDraft - this guard catches the rest.
        try {
          const polished = await polishDraft(prompt, rawDraft, {
            maxRounds: Number.parseInt(opts.polishRounds, 10) || 3,
            onRound: (line) => console.log(line),
          });
          draft = polished.draft;
        } catch (err) {
          console.warn(`Polish pass failed (${(err as Error).message.split('\n')[0]}) - writing the unpolished draft.`);
        }
      }

      if (fs.existsSync(outPath)) {
        console.warn(`Overwriting existing draft at ${outPath} - any manual edits there are gone.`);
      }
      fs.writeFileSync(outPath, draft.endsWith('\n') ? draft : `${draft}\n`);
      console.log(`Wrote ${outPath}`);
      console.log('Review it, then copy the BODY into your mail client and replace the https://<CLIENT>.shakaperf.com placeholder with the deployed report URL.');
    });
}
