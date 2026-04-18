import * as fs from 'fs';
import * as path from 'path';
import type { ReportData } from './types';

const DATA_TAG_OPEN = '<script id="__shaka_report_data__" type="application/json">';
const DATA_TAG_CLOSE = '</script>';

function locateTemplate(): string {
  // After tsc + copy-assets, the template lives at <pkg>/dist/report-shell/index.html.
  // During dev (no copy-assets yet), fall back to the Vite output directly.
  const candidates = [
    path.resolve(__dirname, '..', '..', 'report-shell', 'index.html'),
    path.resolve(__dirname, '..', '..', '..', 'report-shell', 'dist', 'index.html'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `report-shell HTML template not found. Run \`vite build\` in packages/shaka-perf/report-shell first. Tried:\n${candidates.join('\n')}`,
  );
}

function escapeForScript(json: string): string {
  // Prevent </script> in payload from terminating the inline script.
  return json.replace(/<\/(script)/gi, '<\\/$1');
}

export function renderReportHtml(data: ReportData): string {
  const templatePath = locateTemplate();
  const template = fs.readFileSync(templatePath, 'utf8');

  const start = template.indexOf(DATA_TAG_OPEN);
  if (start < 0) {
    throw new Error(`report-shell template missing data placeholder: ${templatePath}`);
  }
  const end = template.indexOf(DATA_TAG_CLOSE, start + DATA_TAG_OPEN.length);
  if (end < 0) {
    throw new Error(`report-shell template malformed near data placeholder: ${templatePath}`);
  }

  const payload = escapeForScript(JSON.stringify(data));
  return (
    template.slice(0, start + DATA_TAG_OPEN.length) +
    payload +
    template.slice(end)
  );
}

export function writeReport(data: ReportData, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const html = renderReportHtml(data);
  const outPath = path.join(outDir, 'report.html');
  fs.writeFileSync(outPath, html);
  return outPath;
}
