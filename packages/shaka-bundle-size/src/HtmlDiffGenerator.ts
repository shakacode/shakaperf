/**
 * HtmlDiffGenerator - Generates HTML diff artifacts for CI visualization.
 *
 * Creates side-by-side HTML diffs comparing baseline JSON files against
 * current JSON files using diff2html-cli.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type {
  HtmlDiffGeneratorConfig,
  DiffMetadata,
  SingleDiffOptions,
  GenerateDiffsOptions,
} from './types';

/**
 * Generates HTML diff artifacts for bundle size comparisons.
 */
export class HtmlDiffGenerator {
  private diff2htmlPath: string;

  /**
   * Creates a new HtmlDiffGenerator.
   */
  constructor({ diff2htmlPath = 'diff2html' }: HtmlDiffGeneratorConfig = {}) {
    this.diff2htmlPath = diff2htmlPath;
  }

  /**
   * Ensures the output directory exists.
   */
  ensureDirectoryExists(outputDir: string): void {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  /**
   * Gets all files in a directory.
   */
  getFilesInDirectory(dir: string): string[] {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir);
  }

  /**
   * Builds metadata injection script for HTML template.
   */
  buildMetadataScript(filename: string, metadata: DiffMetadata): string {
    const { masterCommit = '', branchName = '', currentCommit = '' } = metadata;

    // Script that replaces placeholder elements with actual values
    const script = `
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

    // Compress to single line and use double quotes for shell compatibility
    return script.replace(/\n/g, ' ').replace(/'/g, '"');
  }

  /**
   * Escapes HTML special characters.
   */
  escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Generates diff between two files using diff command.
   */
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

  /**
   * Generates HTML diff file using diff2html.
   */
  generateHtmlFromDiff(diffContent: string, outputPath: string, templatePath: string, titleScript: string): void {
    // Write diff to temp file for piping
    const tempDiffPath = `${outputPath}.diff.tmp`;
    fs.writeFileSync(tempDiffPath, diffContent, 'utf8');

    try {
      const command = `cat "${tempDiffPath}" | ${this.diff2htmlPath} --hwt "${templatePath}" -i stdin -s side -o stdout -t '${titleScript}' > "${outputPath}"`;
      execSync(command, {
        encoding: 'utf8',
        shell: '/bin/bash',
        maxBuffer: 50 * 1024 * 1024,
      });
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempDiffPath)) {
        fs.unlinkSync(tempDiffPath);
      }
    }
  }

  /**
   * Generates HTML diff for a single file.
   */
  generateSingleDiff({ filename, controlDir, currentDir, outputDir, templatePath, metadata }: SingleDiffOptions): string | null {
    const controlFile = path.join(controlDir, filename);
    const currentFile = path.join(currentDir, filename);
    const outputFile = path.join(outputDir, `${filename}.diff.html`);

    // Skip if control file doesn't exist (new file)
    if (!fs.existsSync(controlFile)) {
      return null;
    }

    // Skip if current file doesn't exist (deleted file)
    if (!fs.existsSync(currentFile)) {
      return null;
    }

    const diffContent = this.generateUnifiedDiff(controlFile, currentFile);

    // Skip if files are identical
    if (!diffContent) {
      return null;
    }

    const titleScript = this.buildMetadataScript(filename, metadata);
    this.generateHtmlFromDiff(diffContent, outputFile, templatePath, titleScript);

    return outputFile;
  }

  /**
   * Generates HTML diffs for all files in the current directory.
   */
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
