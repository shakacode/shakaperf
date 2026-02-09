import * as fs from 'fs';
import * as path from 'path';
import { HtmlDiffGenerator } from '../HtmlDiffGenerator';

describe('HtmlDiffGenerator', () => {
  const tmpDir = path.join(__dirname, 'tmp-html-diff');
  const controlDir = path.join(tmpDir, 'control');
  const currentDir = path.join(tmpDir, 'current');
  const outputDir = path.join(tmpDir, 'output');
  const templateDir = path.join(tmpDir, 'templates');
  const templatePath = path.join(templateDir, 'template.html');

  const minimalTemplate = `<!DOCTYPE html>
<html>
<head>
<!--diff2html-css-->
<!--diff2html-title-->
</head>
<body>
<!--diff2html-js-ui-->
<div id="diff"><!--diff2html-diff--></div>
<script>
const targetElement = document.getElementById('diff');
const diff2htmlUi = new Diff2HtmlUI(targetElement);
//diff2html-fileListToggle
//diff2html-synchronisedScroll
//diff2html-highlightCode
</script>
</body>
</html>`;

  beforeEach(() => {
    fs.mkdirSync(controlDir, { recursive: true });
    fs.mkdirSync(currentDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(templatePath, minimalTemplate);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('escapeHtml', () => {
    it('escapes special HTML characters', () => {
      const gen = new HtmlDiffGenerator();
      expect(gen.escapeHtml('&')).toBe('&amp;');
      expect(gen.escapeHtml('<')).toBe('&lt;');
      expect(gen.escapeHtml('>')).toBe('&gt;');
      expect(gen.escapeHtml('"')).toBe('&quot;');
      expect(gen.escapeHtml("'")).toBe('&#039;');
    });

    it('escapes multiple characters in one string', () => {
      const gen = new HtmlDiffGenerator();
      expect(gen.escapeHtml('<div class="test">')).toBe('&lt;div class=&quot;test&quot;&gt;');
    });

    it('returns empty string unchanged', () => {
      const gen = new HtmlDiffGenerator();
      expect(gen.escapeHtml('')).toBe('');
    });
  });

  describe('ensureDirectoryExists', () => {
    it('creates directory if it does not exist', () => {
      const gen = new HtmlDiffGenerator();
      const newDir = path.join(tmpDir, 'new-dir');
      gen.ensureDirectoryExists(newDir);
      expect(fs.existsSync(newDir)).toBe(true);
    });
  });

  describe('getFilesInDirectory', () => {
    it('returns files in a directory', () => {
      const gen = new HtmlDiffGenerator();
      fs.writeFileSync(path.join(currentDir, 'a.json'), '{}');
      fs.writeFileSync(path.join(currentDir, 'b.txt'), '');
      const files = gen.getFilesInDirectory(currentDir);
      expect(files).toContain('a.json');
      expect(files).toContain('b.txt');
    });

    it('returns empty array for non-existent directory', () => {
      const gen = new HtmlDiffGenerator();
      expect(gen.getFilesInDirectory('/nonexistent')).toEqual([]);
    });
  });

  describe('buildMetadataScript', () => {
    it('includes all metadata fields', () => {
      const gen = new HtmlDiffGenerator();
      const script = gen.buildMetadataScript('config.json', {
        masterCommit: 'abc1234',
        branchName: 'feature/test',
        currentCommit: 'def5678',
      });
      expect(script).toContain('config.json');
      expect(script).toContain('abc1234');
      expect(script).toContain('feature/test');
      expect(script).toContain('def5678');
    });

    it('handles empty metadata', () => {
      const gen = new HtmlDiffGenerator();
      const script = gen.buildMetadataScript('file.json', {});
      expect(script).toContain('file.json');
      expect(script).toContain('<script>');
    });

    it('escapes HTML in filename', () => {
      const gen = new HtmlDiffGenerator();
      const script = gen.buildMetadataScript('<script>alert(1)</script>', {});
      expect(script).not.toContain('<script>alert(1)</script>');
      expect(script).toContain('&lt;script&gt;');
    });
  });

  describe('generateUnifiedDiff', () => {
    it('returns empty string for identical files', () => {
      const gen = new HtmlDiffGenerator();
      const file1 = path.join(tmpDir, 'same1.txt');
      const file2 = path.join(tmpDir, 'same2.txt');
      fs.writeFileSync(file1, 'same content');
      fs.writeFileSync(file2, 'same content');
      expect(gen.generateUnifiedDiff(file1, file2)).toBe('');
    });

    it('returns diff content for different files', () => {
      const gen = new HtmlDiffGenerator();
      const file1 = path.join(tmpDir, 'old.txt');
      const file2 = path.join(tmpDir, 'new.txt');
      fs.writeFileSync(file1, 'old content\n');
      fs.writeFileSync(file2, 'new content\n');
      const diff = gen.generateUnifiedDiff(file1, file2);
      expect(diff.length).toBeGreaterThan(0);
    });
  });

  describe('generateHtmlFromDiff', () => {
    it('generates HTML file with diff content', () => {
      const gen = new HtmlDiffGenerator();
      const outputFile = path.join(outputDir, 'test.diff.html');
      const diffContent = '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n';

      gen.generateHtmlFromDiff(diffContent, outputFile, templatePath, {}, 'test.json');

      expect(fs.existsSync(outputFile)).toBe(true);
      const html = fs.readFileSync(outputFile, 'utf8');
      expect(html).toContain('diff2html');
      expect(html).toContain('test.json');
    });

    it('injects metadata script', () => {
      const gen = new HtmlDiffGenerator();
      const outputFile = path.join(outputDir, 'meta.diff.html');
      const diffContent = '--- a\n+++ b\n';

      gen.generateHtmlFromDiff(diffContent, outputFile, templatePath, {
        masterCommit: 'abc',
        branchName: 'main',
      }, 'test.json');

      const html = fs.readFileSync(outputFile, 'utf8');
      expect(html).toContain('abc');
      expect(html).toContain('main');
    });
  });

  describe('generateSingleDiff', () => {
    it('returns null when control file does not exist', () => {
      const gen = new HtmlDiffGenerator();
      fs.writeFileSync(path.join(currentDir, 'file.json'), '{}');

      const result = gen.generateSingleDiff({
        filename: 'file.json',
        controlDir,
        currentDir,
        outputDir,
        templatePath,
        metadata: {},
      });
      expect(result).toBeNull();
    });

    it('returns null when current file does not exist', () => {
      const gen = new HtmlDiffGenerator();
      fs.writeFileSync(path.join(controlDir, 'file.json'), '{}');

      const result = gen.generateSingleDiff({
        filename: 'file.json',
        controlDir,
        currentDir,
        outputDir,
        templatePath,
        metadata: {},
      });
      expect(result).toBeNull();
    });

    it('returns null when files are identical', () => {
      const gen = new HtmlDiffGenerator();
      fs.writeFileSync(path.join(controlDir, 'file.json'), '{"same": true}');
      fs.writeFileSync(path.join(currentDir, 'file.json'), '{"same": true}');

      const result = gen.generateSingleDiff({
        filename: 'file.json',
        controlDir,
        currentDir,
        outputDir,
        templatePath,
        metadata: {},
      });
      expect(result).toBeNull();
    });

    it('generates diff HTML when files differ', () => {
      const gen = new HtmlDiffGenerator();
      fs.writeFileSync(path.join(controlDir, 'file.json'), '{"size": 100}\n');
      fs.writeFileSync(path.join(currentDir, 'file.json'), '{"size": 200}\n');

      const result = gen.generateSingleDiff({
        filename: 'file.json',
        controlDir,
        currentDir,
        outputDir,
        templatePath,
        metadata: {},
      });
      expect(result).not.toBeNull();
      expect(fs.existsSync(result!)).toBe(true);
    });
  });

  describe('generateDiffs', () => {
    it('generates diffs for all files in current directory', () => {
      const gen = new HtmlDiffGenerator();
      fs.writeFileSync(path.join(controlDir, 'a.json'), '{"v":1}\n');
      fs.writeFileSync(path.join(currentDir, 'a.json'), '{"v":2}\n');
      fs.writeFileSync(path.join(controlDir, 'b.txt'), 'old\n');
      fs.writeFileSync(path.join(currentDir, 'b.txt'), 'new\n');

      const files = gen.generateDiffs({
        controlDir,
        currentDir,
        outputDir,
        templatePath,
      });
      expect(files.length).toBe(2);
    });

    it('creates output directory if needed', () => {
      const gen = new HtmlDiffGenerator();
      const newOutputDir = path.join(tmpDir, 'new-output');

      gen.generateDiffs({
        controlDir,
        currentDir,
        outputDir: newOutputDir,
        templatePath,
      });
      expect(fs.existsSync(newOutputDir)).toBe(true);
    });

    it('returns empty array when no diffs found', () => {
      const gen = new HtmlDiffGenerator();
      // Same content in both dirs
      fs.writeFileSync(path.join(controlDir, 'same.json'), '{}');
      fs.writeFileSync(path.join(currentDir, 'same.json'), '{}');

      const files = gen.generateDiffs({
        controlDir,
        currentDir,
        outputDir,
        templatePath,
      });
      expect(files).toEqual([]);
    });
  });
});
