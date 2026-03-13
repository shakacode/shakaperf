import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { generateUnifiedDiff, buildDiffHtml } from '../shared/html-diff';

function hostPatternFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.host.replace(':', '_');
}

export interface GenerateHtmlDiffsOptions {
  testResultsFolder: string;
  controlURL: string;
  experimentURL: string;
}

export function generateHtmlDiffs(options: GenerateHtmlDiffsOptions): string[] {
  const { testResultsFolder, controlURL, experimentURL } = options;

  const controlPattern = hostPatternFromUrl(controlURL);
  const experimentPattern = hostPatternFromUrl(experimentURL);

  if (!existsSync(testResultsFolder)) {
    return [];
  }

  const allFiles = readdirSync(testResultsFolder);
  const txtFiles = allFiles.filter(f => f.endsWith('.txt'));
  const controlFiles = txtFiles.filter(f => f.startsWith(controlPattern));
  const generatedFiles: string[] = [];

  for (const controlFile of controlFiles) {
    const experimentFile = controlFile.replace(controlPattern, experimentPattern);
    const controlPath = path.join(testResultsFolder, controlFile);
    const experimentPath = path.join(testResultsFolder, experimentFile);

    if (!existsSync(experimentPath)) {
      continue;
    }

    const diffContent = generateUnifiedDiff(controlPath, experimentPath);
    if (!diffContent) {
      continue;
    }

    const artifactSuffix = controlFile
      .replace(controlPattern, '')
      .replace(/^_+/, '')
      .replace(/\.txt$/, '');

    const title = artifactSuffix.replace(/_/g, ' ');
    const outputPath = path.join(testResultsFolder, `${artifactSuffix}.diff.html`);

    const html = buildDiffHtml(diffContent, title);
    writeFileSync(outputPath, html, 'utf8');
    generatedFiles.push(outputPath);

    console.log(`HTML diff: ${outputPath}`);
  }

  return generatedFiles;
}
