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
import { parseReport } from '../parse-report';

// At runtime __dirname is dist/discover-abtests/cli/, so go up three levels to
// the package root. The browser-side JS scripts are bundled into
// dist/skills/discover-abtests/scripts/ by scripts/copy-assets.mjs (sourced
// from the repo-root .claude/ dir).
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.resolve(PACKAGE_ROOT, 'dist', 'skills', 'discover-abtests', 'scripts');
const DEFAULT_RESULTS_ROOT = 'compare-results';

function printScript(filename: string): void {
  const filePath = path.resolve(SCRIPTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `discover-abtests: bundled script not found at ${filePath}. ` +
        'Re-install shaka-perf, or run `yarn build` if you are running from a source checkout.',
    );
  }
  process.stdout.write(fs.readFileSync(filePath, 'utf8'));
}

export function findDefaultVisregReports(resultsRoot = DEFAULT_RESULTS_ROOT): string[] {
  if (!fs.existsSync(resultsRoot)) return [];

  return fs.readdirSync(resultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(resultsRoot, entry.name, 'artifacts', 'report.json'))
    .filter((reportPath) => fs.existsSync(reportPath))
    .sort();
}

export function createDiscoverAbtestsCommand(): Command {
  const cmd = new Command('discover-abtests').description(
    'Helpers for the discover-abtests Claude Code skill: prints browser script sources and summarizes visreg reports.',
  );

  cmd
    .command('extract-links')
    .description('Print the JS source that collects internal links on the current page (feed into javascript_tool).')
    .action(() => printScript('extract-links.js'));

  cmd
    .command('probe-lazy-load')
    .description('Print the JS source for the lazy-load probe (feed into javascript_tool).')
    .action(() => printScript('probe-lazy-load.js'));

  cmd
    .command('probe-sections')
    .description('Print the JS source that scores candidate section selectors on tall pages (feed into javascript_tool).')
    .action(() => printScript('probe-sections.js'));

  cmd
    .command('parse-report')
    .description('Summarize visreg report.json files: pass/fail, diff %, whitespace, engine errors.')
    .argument('[path]', 'Path to one report.json; omit to read compare-results/ per-unit reports')
    .action((reportPath?: string) => {
      if (reportPath) {
        parseReport(reportPath);
        return;
      }

      const reportPaths = findDefaultVisregReports();
      if (reportPaths.length === 0) {
        console.error(
          'No per-unit visreg reports found under compare-results/. ' +
          'Run `shaka-perf compare --categories visreg` first, or pass a report.json path.',
        );
        process.exitCode = 1;
        return;
      }

      for (const reportPath of reportPaths) {
        if (reportPaths.length > 1) console.log(`\n${reportPath}`);
        parseReport(reportPath);
      }
    });

  return cmd;
}
