/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { generateUnifiedDiff, buildDiffHtml } from 'shaka-shared';

export interface GenerateHtmlDiffsOptions {
  testResultsFolder: string;
}

const CONTROL_PREFIX = 'control_';
const EXPERIMENT_PREFIX = 'experiment_';
const PROFILE_SUMMARY_SUFFIX = 'performance_profile.summary.txt';

/** The one artifact an AI reviewer is pointed at: the profile summaries'
 *  unified diff as plain text, next to the HTML rendering of the same diff. */
export const AI_ANALYSIS_DIFF_FILENAME = 'the_only_file_ai_needs_to_analyze.diff';

/**
 * Emits one `<artifact>.diff.html` per control/experiment .txt pair — keeps
 * network_activity and performance_profile.summary diffs as separate artifacts
 * so the report can surface a dedicated button for each.
 */
export function generateHtmlDiffs(options: GenerateHtmlDiffsOptions): string[] {
  const { testResultsFolder } = options;

  if (!existsSync(testResultsFolder)) {
    return [];
  }

  const allFiles = readdirSync(testResultsFolder);
  const txtFiles = allFiles.filter((f) => f.endsWith('.txt')).sort();
  const controlFiles = txtFiles.filter((f) => f.startsWith(CONTROL_PREFIX));

  const generatedFiles: string[] = [];
  for (const controlFile of controlFiles) {
    const experimentFile = EXPERIMENT_PREFIX + controlFile.slice(CONTROL_PREFIX.length);
    const controlPath = path.join(testResultsFolder, controlFile);
    const experimentPath = path.join(testResultsFolder, experimentFile);
    if (!existsSync(experimentPath)) continue;
    const diffContent = generateUnifiedDiff(controlPath, experimentPath);
    if (!diffContent) continue;

    const artifactSuffix = controlFile.slice(CONTROL_PREFIX.length).replace(/\.txt$/, '');
    const title = artifactSuffix.replace(/_/g, ' ');
    const outputPath = path.join(testResultsFolder, `${artifactSuffix}.diff.html`);

    const html = buildDiffHtml(diffContent, title);
    writeFileSync(outputPath, html, 'utf8');
    generatedFiles.push(outputPath);
    console.log(`HTML diff: ${outputPath}`);
  }

  return generatedFiles;
}

/**
 * Write `the_only_file_ai_needs_to_analyze.diff`: the plain unified diff of
 * the two profile summaries. Returns its path, or null when either summary is
 * missing. Identical summaries still produce the file, saying so.
 */
export function writeAiAnalysisDiff(testResultsFolder: string): string | null {
  const controlPath = path.join(testResultsFolder, CONTROL_PREFIX + PROFILE_SUMMARY_SUFFIX);
  const experimentPath = path.join(testResultsFolder, EXPERIMENT_PREFIX + PROFILE_SUMMARY_SUFFIX);
  if (!existsSync(controlPath) || !existsSync(experimentPath)) return null;
  const diffContent = generateUnifiedDiff(controlPath, experimentPath)
    || `The control and experiment performance profile summaries are identical (${path.basename(controlPath)} vs ${path.basename(experimentPath)}).\n`;
  const outputPath = path.join(testResultsFolder, AI_ANALYSIS_DIFF_FILENAME);
  writeFileSync(outputPath, diffContent, 'utf8');
  return outputPath;
}
