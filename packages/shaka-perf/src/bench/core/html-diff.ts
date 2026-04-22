import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { generateUnifiedDiff, buildDiffHtml } from 'shaka-shared';

function hostPatternFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.host.replace(':', '_');
}

export interface GenerateHtmlDiffsOptions {
  testResultsFolder: string;
  controlURL: string;
  experimentURL: string;
}

/**
 * Builds a single diff.html that stacks every control/experiment .txt pair
 * found in `testResultsFolder` as separate file sections. Diff2Html renders
 * each pair as a collapsible panel, so reviewers see network_activity +
 * performance_profile.summary (and any future text artifacts) in one place.
 *
 * Returns the written path, or null when no pair produced a diff.
 */
export function generateHtmlDiffs(options: GenerateHtmlDiffsOptions): string | null {
  const { testResultsFolder, controlURL, experimentURL } = options;

  const controlPattern = hostPatternFromUrl(controlURL);
  const experimentPattern = hostPatternFromUrl(experimentURL);

  if (!existsSync(testResultsFolder)) {
    return null;
  }

  const allFiles = readdirSync(testResultsFolder);
  const txtFiles = allFiles.filter((f) => f.endsWith('.txt')).sort();
  const controlFiles = txtFiles.filter((f) => f.startsWith(controlPattern));

  const sections: string[] = [];
  for (const controlFile of controlFiles) {
    const experimentFile = controlFile.replace(controlPattern, experimentPattern);
    const controlPath = path.join(testResultsFolder, controlFile);
    const experimentPath = path.join(testResultsFolder, experimentFile);
    if (!existsSync(experimentPath)) continue;
    const diffContent = generateUnifiedDiff(controlPath, experimentPath);
    if (!diffContent) continue;
    sections.push(diffContent);
  }

  if (sections.length === 0) {
    return null;
  }

  const outputPath = path.join(testResultsFolder, 'diff.html');
  // Multiple diff blocks concatenated produce a valid multi-file unified diff;
  // Diff2Html renders each "--- / +++" block as its own file panel.
  const html = buildDiffHtml(sections.join('\n'), 'Control vs experiment', {
    drawFileList: true,
  });
  writeFileSync(outputPath, html, 'utf8');
  console.log(`HTML diff: ${outputPath}`);
  return outputPath;
}
