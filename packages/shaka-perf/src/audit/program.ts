/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command, Option } from 'commander';
import { findAbTestsConfig, loadAbTestsConfig } from '../config-loader';
import { parseAbTestsConfig, viewportsByStageCategory } from '../config';
import { runPipeline } from '../pipeline/runner';
import { printReportSummary, reportPipelineFailure } from '../pipeline/report-summary';
import { auditPipelineMetadata, createAuditPipeline } from './pipeline';

export interface CreateAuditCommandOptions {
  urlDefault?: string;
}

export function createAuditCommand(options: CreateAuditCommandOptions = {}): Command {
  const validStages = auditPipelineMetadata.stages;
  const validCategories = auditPipelineMetadata.categories;
  return new Command('audit')
    .description(auditPipelineMetadata.description)
    .option(
      '--categories <list>',
      `Comma-separated list of categories to run (${validCategories.join(', ')})`,
      validCategories.join(','),
    )
    .option(
      '--skip-stages <list>',
      `Comma-separated list of exact stages to skip (${validStages.join(', ')})`,
    )
    .option(
      '--restart-from-stage <stage>',
      `Restart from this stage: discard its results and all later stages' results, then re-run them; earlier stages' results are preserved (${validStages.join(', ')})`,
    )
    .addOption(new Option(
      '--resume-from-stage <stage>',
      'Deprecated alias for --restart-from-stage',
    ).hideHelp())
    .option('-c, --config <path>', 'Path to abtests.config.ts (default: cwd lookup)')
    .option('--url <url>', 'Application URL to audit', options.urlDefault)
    .option('--testPathPattern <regex>', 'Regex pattern to filter discovered .abtest.ts/.abtest.js files (like Jest)')
    .option(
      '--filter <value>',
      'Regex/substring to filter tests by name (comma-separated for multiple), OR a path to a single .abtest.ts/.abtest.js file',
    )
    .option('--report-only', 'Re-render the HTML report from existing audit-results/ stage outcomes without re-running engines. Complements --skip-report for sharded CI assembly.', false)
    .option('--skip-report', 'Run the audit engine but do not produce the top-level report.html / report.json. Intended for CI shards; engine errors are persisted so a later --report-only run can include them.', false)
    .option('--keep-old-results', 'Do not wipe audit-results/ before running. Engines still overwrite the files they produce, but unrelated artifacts from a prior run survive instead of being cleared.', false)
    .option('--debug-show-all-frames', 'Diagnostics: also render the FULL, non-deduped screencast timeline alongside the normal (deduped) one. Every synced frame is shown, each annotated with the pixel diff vs the previous frame (the signal the dedupe uses to decide what to drop). Off by default — produces a much heavier report.', false)
    .option('--full-report-zip', 'After the run, bundle the full report and all its artifacts into full-report.zip. Off by default — the archive can be large.', false)
    .option('--headed', 'Launch the measurement browser headed (visible window) instead of headless. Off by default.', false)
    .action(async function (this: Command) {
      const opts = this.opts();
      const configPath = opts.config ?? findAbTestsConfig();
      const raw = configPath ? await loadAbTestsConfig(configPath) : {};
      const config = parseAbTestsConfig(raw);
      const url = opts.url ?? config.shared.experimentURL;
      const pipeline = createAuditPipeline({
        parallelism: config.shared.parallelism,
        lighthouseConfig: config.audit.lighthouseConfig,
        limitVideoFramesCount: config.audit.limitVideoFramesCount,
        accessibility: {
          tags: config.accessibility.tags,
          disableRules: config.accessibility.disableRules,
          includeRules: config.accessibility.includeRules,
          engineOptions: config.accessibility.engineOptions,
          failOnViolation: config.accessibility.failOnViolation,
        },
      });
      const restartFromStage = opts.restartFromStage ?? opts.resumeFromStage;
      const result = await runPipeline(pipeline, {
        controlURL: url,
        experimentURL: url,
        testPathPattern: opts.testPathPattern ?? config.shared.testPathPattern,
        filter: opts.filter ?? config.shared.filter,
        categories: opts.categories,
        skipStages: opts.skipStages,
        restartFromStage,
        reportOnly: opts.reportOnly === true,
        skipReport: opts.skipReport === true,
        keepOldResults: opts.keepOldResults === true,
        debugShowAllFrames: opts.debugShowAllFrames === true,
        fullReportZip: opts.fullReportZip === true,
        headed: opts.headed === true,
        retries: config.shared.retries,
        retryDelay: config.shared.retryDelay,
        timeoutMs: config.shared.timeoutMs,
        viewports: viewportsByStageCategory(config),
      });
      printReportSummary(result);
      maybeGenerateCoverageReport(result.resultsRoot);
      reportPipelineFailure(result);
    });
}

// Generates an HTML + text-summary Istanbul report from per-test coverage JSONs
// the audit engine drained off each Playwright page. Soft-depends on nyc being
// available in the user's project. If nyc can't be found we print actionable
// instructions instead of erroring — the .nyc_output/ dir is still on disk.
function maybeGenerateCoverageReport(resultsRoot: string): void {
  const nycDir = path.join(resultsRoot, '.nyc_output');
  if (!fs.existsSync(nycDir) || fs.readdirSync(nycDir).length === 0) return;
  const reportDir = path.join(resultsRoot, 'coverage');
  fs.mkdirSync(reportDir, { recursive: true });
  const nycBin = resolveNycBin(resultsRoot);
  const nycArgs = [
    'report',
    `--temp-dir=${nycDir}`,
    `--report-dir=${reportDir}`,
    '--reporter=html',
    '--reporter=text-summary',
  ];
  if (!nycBin) {
    console.log(
      `\nCoverage JSONs: ${nycDir} (install nyc and run \`npx nyc ${nycArgs.join(' ')}\` to view)`,
    );
    return;
  }
  const proc = spawnSync(nycBin, nycArgs, { stdio: 'inherit' });
  if (proc.status === 0) {
    console.log(`Coverage report: ${path.join(reportDir, 'index.html')}`);
    return;
  }
  const signal = proc.signal ? `, signal=${proc.signal}` : '';
  const spawnError = proc.error ? `, error=${proc.error.message}` : '';
  console.warn(
    `\nnyc report failed (status=${proc.status}${signal}${spawnError}). Raw data in ${nycDir}. ` +
      `Re-run manually: ${nycBin} ${nycArgs.join(' ')}`,
  );
}

function resolveNycBin(resultsRoot: string): string | null {
  // Walk from the results dir to the filesystem root looking for
  // node_modules/.bin/nyc — works whether the user invoked us from the
  // project root or a subdirectory of it. One stat per level is cheap.
  let dir = path.resolve(resultsRoot);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'nyc');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
