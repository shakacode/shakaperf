import { execSync } from 'child_process';

export function generateUnifiedDiff(controlFile: string, currentFile: string): string {
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

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface BuildDiffHtmlOptions {
  leftLabel?: string;
  rightLabel?: string;
  /**
   * When true, diff2html renders a clickable list of the files at the top —
   * useful when `diffContent` is a concatenated multi-file unified diff so
   * readers can jump to the section they care about.
   */
  drawFileList?: boolean;
}

export function buildDiffHtml(diffContent: string, title: string, options: BuildDiffHtmlOptions = {}): string {
  const { leftLabel = 'Control', rightLabel = 'Experiment', drawFileList = false } = options;
  const escapedDiff = JSON.stringify(diffContent);
  const config = JSON.stringify({
    drawFileList,
    matching: 'lines',
    outputFormat: 'side-by-side',
    synchronisedScroll: true,
    highlight: true,
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html-ui.min.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
    h1 { color: #333; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
    .info { background-color: #e6f3ff; border-radius: 5px; padding: 15px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="info">
    <strong>Left:</strong> ${escapeHtml(leftLabel)} &nbsp;&nbsp;|&nbsp;&nbsp; <strong>Right:</strong> ${escapeHtml(rightLabel)}
  </div>
  <div id="diff"></div>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      var targetElement = document.getElementById('diff');
      var diff2htmlUi = new Diff2HtmlUI(targetElement, ${escapedDiff}, ${config});
      diff2htmlUi.draw();
      diff2htmlUi.highlightCode();
    });
  </script>
</body>
</html>`;
}
