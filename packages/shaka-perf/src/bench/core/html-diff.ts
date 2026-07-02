/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
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
