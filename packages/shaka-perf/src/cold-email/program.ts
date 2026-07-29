/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';

import { synthesizeSite } from '../warm-email/synthesis';
import { buildColdPrompt, generateColdEmail } from './generate';
import { assembleLeadFromCampaign } from './campaign-lead';
import { writeClientReport } from '../warm-email/client-report';
import { claudeCaptionRefiner } from '../warm-email/caption-ai';
import { claudeA11ySummarizer } from '../warm-email/a11y-summary-ai';
import { claudeAgentSummarizer } from '../warm-email/agent-ready-summary-ai';
import { CLIENT_REPORT_FILENAME, addClientReportNarrativeOption, clientReportNarrativeOpts } from '../warm-email/client-report-program';
import { polishDraft } from '../email-polish/polish';

// The reply attaches the CLIENT-facing report by default (clean filmstrips +
// plain language), not the heavy technical one. Override with --report to point
// at self-contained-performance-report.html if you want the full diagnostic.
const DEFAULT_REPORT = CLIENT_REPORT_FILENAME;

// `shaka-perf cold-email` - the cold-outreach sibling of warm-email. A cold
// campaign email promised the prospect their top bottlenecks + an optimization
// plan, free; the prospect replied. This command reads a SAVED audit-results
// directory + a lead context file (who they are, the exact email we sent, what
// they replied), and drafts the threaded REPLY that delivers the promise, with
// the client-facing report attached. See ../../README-cold-email.md.
export function createColdEmailCommand(): Command {
  const cmd = new Command('cold-email')
    .description('Draft the promised-writeup reply to a cold-email response, from a saved audit-results dir + lead context')
    .requiredOption('--results <dir>', 'Path to a saved audit-results directory (must contain report.json)')
    .option('--lead <path>', 'Path to a hand-written lead context (yaml/markdown/text: the prospect, the sent cold email, their reply)')
    .option('--campaign-csv <path>', 'Campaign mode: the campaign upload CSV (merge-field source for the sent email)')
    .option('--campaign-template <path>', 'Campaign mode: the locked spintax template markdown; option 1 of every block = the sent base wording')
    .option('--lead-domain <domain>', 'Campaign mode: pick the lead row by company domain')
    .option('--lead-email <email>', 'Campaign mode: pick the lead row by email (disambiguates multi-lead companies)')
    .option('--reply-text <text>', 'Campaign mode: what the prospect replied')
    .option('--sent-from <text>', 'Campaign mode: the mailbox the campaign email went out from (recorded in the context)')
    .option('--out <path>', 'Output path for the draft markdown (default: <results>/../cold-email-draft.md)')
    .option('--model <model>', 'Claude model for generation', 'sonnet')
    .option('--report <filename>', `Report filename referenced in ATTACH (default: ${DEFAULT_REPORT})`, DEFAULT_REPORT)
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
      // Two ways to supply the lead context: a hand-written file (--lead) or
      // campaign mode, where the tool reconstructs the sent email itself from
      // the campaign CSV + the locked spintax template. Exactly one.
      const campaignMode = Boolean(opts.campaignCsv || opts.campaignTemplate || opts.leadDomain || opts.leadEmail || opts.replyText);
      if (Boolean(opts.lead) === campaignMode) {
        console.error(
          opts.lead
            ? 'Pass either --lead OR the campaign-mode flags, not both.'
            : 'Lead context missing. Either pass --lead <file>, or use campaign mode: --campaign-csv + --campaign-template + --reply-text + (--lead-domain or --lead-email).',
        );
        process.exit(1);
      }

      // The draft location decides what the ATTACH path is relative to - with
      // --out it is no longer next to the results dir's parent.
      const outPath = opts.out
        ? path.resolve(opts.out)
        : path.join(path.dirname(resultsDir), 'cold-email-draft.md');

      let leadNotes: string;
      if (campaignMode) {
        const missing: string[] = [];
        if (!opts.campaignCsv) missing.push('--campaign-csv');
        if (!opts.campaignTemplate) missing.push('--campaign-template');
        if (!opts.replyText) missing.push('--reply-text');
        if (!opts.leadDomain && !opts.leadEmail) missing.push('--lead-domain or --lead-email');
        if (missing.length > 0) {
          console.error(`Campaign mode needs ${missing.join(', ')}.`);
          process.exit(1);
        }
        const csvPath = path.resolve(opts.campaignCsv);
        const templatePath = path.resolve(opts.campaignTemplate);
        for (const [label, p] of [['Campaign CSV', csvPath], ['Campaign template', templatePath]] as const) {
          if (!fs.existsSync(p)) {
            console.error(`${label} not found: ${p}`);
            process.exit(1);
          }
        }
        let assembled;
        try {
          assembled = assembleLeadFromCampaign({
            csvText: fs.readFileSync(csvPath, 'utf8'),
            templateMd: fs.readFileSync(templatePath, 'utf8'),
            selector: { domain: opts.leadDomain, email: opts.leadEmail },
            replyText: opts.replyText,
            campaignName: path.basename(csvPath, path.extname(csvPath)),
            sentFrom: opts.sentFrom,
          });
        } catch (err) {
          console.error((err as Error).message);
          process.exit(1);
        }
        leadNotes = assembled.leadContext;
        console.log(`Campaign lead: ${assembled.row['firstName']} ${assembled.row['person_title'] ? `(${assembled.row['person_title']}) ` : ''}<${assembled.row['email']}> at ${assembled.row['companyName']}.`);
        console.log(`Reconstructed sent email "${assembled.sentSubject}" from the template's base wording.`);
        // Persist what the model is about to be fed: reviewable, and reusable
        // later as a plain --lead file.
        const contextPath = path.join(path.dirname(outPath), 'lead-context.generated.yaml');
        fs.writeFileSync(contextPath, leadNotes);
        console.log(`Wrote ${contextPath}`);
      } else {
        const leadPath = path.resolve(opts.lead);
        if (!fs.existsSync(leadPath)) {
          console.error(`Lead context file not found: ${leadPath}`);
          process.exit(1);
        }
        leadNotes = fs.readFileSync(leadPath, 'utf8');
      }
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

      // Generate the client-facing report alongside the reply: it IS the
      // promised writeup, so the draft's ATTACH must point at a ready file
      // (opts.report defaults to client-report.html).
      const clientReportPath = path.join(resultsDir, CLIENT_REPORT_FILENAME);
      const reportPages = await writeClientReport(resultsDir, clientReportPath, {
        refineCaptions: opts.aiCaptions === false ? undefined : claudeCaptionRefiner(),
        summarizeA11y: opts.aiA11y === false ? undefined : claudeA11ySummarizer(),
        summarizeAgent: opts.aiAgent === false ? undefined : claudeAgentSummarizer(),
        ...clientReportNarrativeOpts(opts),
      });
      console.log(`Wrote client-facing report for ${reportPages} page(s): ${clientReportPath}`);

      const attachRel = path.relative(path.dirname(outPath), path.join(resultsDir, opts.report));
      // Print before the claude call: the prompt is the debugging tool for
      // exactly the case where that call fails or hangs.
      if (opts.printPrompt) {
        console.error(`\n--- prompt ---\n${buildColdPrompt(scorecard, leadNotes, attachRel)}\n--- end prompt ---\n`);
      }
      console.log(`Generating cold-email reply via claude (${opts.model})...`);
      const { draft: rawDraft, prompt } = await generateColdEmail(scorecard, leadNotes, {
        model: opts.model,
        reportPath: attachRel,
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
      console.log('Review it, then send the BODY as a reply in the SAME thread (Instantly unibox) and attach the report in ATTACH.');
    });
}
