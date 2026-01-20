/**
 * Creates side-by-side HTML diffs comparing baseline JSON files against
 * current JSON files using diff2html.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { parse as parseDiff, html as diffToHtml } from 'diff2html';
import type {
  DiffMetadata,
  SingleDiffOptions,
  GenerateDiffsOptions,
} from './types';

export class HtmlDiffGenerator {
  ensureDirectoryExists(outputDir: string): void {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  getFilesInDirectory(dir: string): string[] {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir);
  }

  buildMetadataScript(filename: string, metadata: DiffMetadata): string {
    const { masterCommit = '', branchName = '', currentCommit = '' } = metadata;

    return `
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          function replaceContent(className, content) {
            document.querySelectorAll('.' + className).forEach(function(el) {
              el.innerHTML = content;
            });
          };
          replaceContent('file-name', '${this.escapeHtml(filename)}');
          replaceContent('master-commit', '${this.escapeHtml(masterCommit)}');
          replaceContent('branch-name', '${this.escapeHtml(branchName)}');
          replaceContent('current-commit', '${this.escapeHtml(currentCommit)}');
        });
      </script>
    `;
  }

  escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  generateUnifiedDiff(controlFile: string, currentFile: string): string {
    try {
      // diff returns exit code 1 when files differ, which is expected
      execSync(`diff -bur "${controlFile}" "${currentFile}"`, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diffs
      });
      return ''; // Files are identical
    } catch (error) {
      const execError = error as { status?: number; stdout?: string };
      if (execError.status === 1) {
        // Exit code 1 means files differ - this is expected
        return execError.stdout || '';
      }
      // Exit code 2 means an actual error occurred
      throw error;
    }
  }

  generateHtmlFromDiff(diffContent: string, outputPath: string, templatePath: string, metadata: DiffMetadata, filename: string): void {
    const diffJson = parseDiff(diffContent, {
      drawFileList: true,
      matching: 'lines',
    });

    const diffHtml = diffToHtml(diffJson, {
      drawFileList: true,
      matching: 'lines',
      outputFormat: 'side-by-side',
    });

    const template = fs.readFileSync(templatePath, 'utf8');
    const metadataScript = this.buildMetadataScript(filename, metadata);
    let html = template;

    if (html.includes('{{diff}}')) {
      html = html.replace('{{diff}}', diffHtml);
    } else if (html.includes('<!-- diff-content -->')) {
      html = html.replace('<!-- diff-content -->', diffHtml);
    } else {
      html = html.replace('</body>', `<div id="diff-container">${diffHtml}</div></body>`);
    }

    html = html.replace('</body>', `${metadataScript}</body>`);

    fs.writeFileSync(outputPath, html, 'utf8');
  }

  generateSingleDiff({ filename, controlDir, currentDir, outputDir, templatePath, metadata }: SingleDiffOptions): string | null {
    const controlFile = path.join(controlDir, filename);
    const currentFile = path.join(currentDir, filename);
    const outputFile = path.join(outputDir, `${filename}.diff.html`);

    if (!fs.existsSync(controlFile)) {
      return null;
    }

    if (!fs.existsSync(currentFile)) {
      return null;
    }

    const diffContent = this.generateUnifiedDiff(controlFile, currentFile);
    if (!diffContent) {
      return null;
    }

    this.generateHtmlFromDiff(diffContent, outputFile, templatePath, metadata, filename);

    return outputFile;
  }

  generateDiffs({ controlDir, currentDir, outputDir, templatePath, metadata = {} }: GenerateDiffsOptions): string[] {
    this.ensureDirectoryExists(outputDir);

    const files = this.getFilesInDirectory(currentDir);
    const generatedFiles: string[] = [];

    for (const filename of files) {
      const outputPath = this.generateSingleDiff({
        filename,
        controlDir,
        currentDir,
        outputDir,
        templatePath,
        metadata,
      });

      if (outputPath) {
        generatedFiles.push(outputPath);
      }
    }

    return generatedFiles;
  }
}
