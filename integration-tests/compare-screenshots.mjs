import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const resultsDir = process.argv[2];
if (!resultsDir) {
  console.error('Usage: compare-screenshots.mjs <results-dir>');
  process.exit(1);
}
const dirName = path.basename(resultsDir);
const oldDir = `/tmp/${dirName}-screenshots-old`;
const diffDir = path.join(resultsDir, 'screenshot-diffs');

// Extract previous screenshots from git (committed or staged)
fs.rmSync(oldDir, { recursive: true, force: true });
fs.mkdirSync(oldDir, { recursive: true });
fs.rmSync(diffDir, { recursive: true, force: true });
fs.mkdirSync(diffDir, { recursive: true });

const tracked = execSync(`git ls-files -- "${resultsDir}/*.screenshot.png"`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
const committed = execSync(`git ls-tree --name-only -r HEAD -- ${resultsDir}/`, { encoding: 'utf-8' }).trim().split('\n').filter(f => f.endsWith('.screenshot.png'));
const allOldPaths = [...new Set([...tracked, ...committed])];
for (const f of allOldPaths) {
  try {
    let data;
    try { data = execSync(`git show HEAD:${f}`, { encoding: 'buffer', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { data = execSync(`git show :${f}`, { encoding: 'buffer', stdio: ['pipe', 'pipe', 'pipe'] }); }
    fs.writeFileSync(path.join(oldDir, path.basename(f)), data);
  } catch {}
}

const oldFiles = fs.readdirSync(oldDir).filter(f => f.endsWith('.screenshot.png'));
const newFiles = fs.readdirSync(resultsDir).filter(f => f.endsWith('.screenshot.png'));
const results = [];

for (const file of oldFiles) {
  if (!newFiles.includes(file)) {
    console.log(`${file}: DELETED`);
    results.push({ file, status: 'DELETED', old: path.join(oldDir, file) });
  }
}

for (const file of newFiles) {
  const oldPath = path.join(oldDir, file);
  const newPath = path.join(resultsDir, file);

  if (!fs.existsSync(oldPath)) {
    console.log(`${file}: NEW (no previous screenshot)`);
    results.push({ file, status: 'NEW', new: newPath });
    continue;
  }

  const oldImg = PNG.sync.read(fs.readFileSync(oldPath));
  const newImg = PNG.sync.read(fs.readFileSync(newPath));

  if (oldImg.width !== newImg.width || oldImg.height !== newImg.height) {
    console.log(`${file}: DIMENSIONS CHANGED (${oldImg.width}x${oldImg.height} -> ${newImg.width}x${newImg.height})`);
    results.push({ file, status: 'DIMENSIONS CHANGED', old: oldPath, new: newPath });
    continue;
  }

  const diff = new PNG({ width: oldImg.width, height: oldImg.height });
  const numDiffPixels = pixelmatch(oldImg.data, newImg.data, diff.data, oldImg.width, oldImg.height, { threshold: 0.1 });
  const totalPixels = oldImg.width * oldImg.height;
  const pct = ((numDiffPixels / totalPixels) * 100).toFixed(2);
  console.log(`${file}: ${numDiffPixels} different pixels (${pct}%)`);

  const diffPath = path.join(diffDir, file.replace('.screenshot.png', '.diff.png'));
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  // Copy old image to diff dir for the report
  fs.copyFileSync(oldPath, path.join(diffDir, file.replace('.screenshot.png', '.old.png')));

  results.push({ file, status: 'COMPARED', pct, numDiffPixels, old: oldPath, new: newPath, diff: diffPath });
}

// Generate HTML report
function toDataUri(filePath) {
  return 'data:image/png;base64,' + fs.readFileSync(filePath).toString('base64');
}

const cards = results.map(r => {
  if (r.status === 'DELETED') return `
    <div class="card deleted">
      <h2>${r.file} — DELETED</h2>
      <div class="images"><div><h3>Previous</h3><img src="${toDataUri(r.old)}"></div></div>
    </div>`;
  if (r.status === 'NEW') return `
    <div class="card new">
      <h2>${r.file} — NEW</h2>
      <div class="images"><div><h3>Current</h3><img src="${toDataUri(r.new)}"></div></div>
    </div>`;
  if (r.status === 'DIMENSIONS CHANGED') return `
    <div class="card warn">
      <h2>${r.file} — DIMENSIONS CHANGED</h2>
      <div class="images">
        <div><h3>Previous</h3><img src="${toDataUri(r.old)}"></div>
        <div><h3>Current</h3><img src="${toDataUri(r.new)}"></div>
      </div>
    </div>`;
  const cls = parseFloat(r.pct) > 5 ? 'warn' : 'ok';
  return `
    <div class="card ${cls}">
      <h2>${r.file} — ${r.pct}% different (${r.numDiffPixels} px)</h2>
      <div class="images">
        <div><h3>Previous</h3><img src="${toDataUri(r.old)}"></div>
        <div><h3>Current</h3><img src="${toDataUri(r.new)}"></div>
        <div><h3>Diff</h3><img src="${toDataUri(r.diff)}"></div>
      </div>
    </div>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Screenshot Diff Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; padding: 24px; }
  h1 { margin-bottom: 24px; }
  .card { background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 24px; border-left: 4px solid #555; }
  .card.ok { border-left-color: #4caf50; }
  .card.warn { border-left-color: #ff9800; }
  .card.deleted { border-left-color: #f44336; }
  .card.new { border-left-color: #2196f3; }
  .card h2 { font-size: 14px; margin-bottom: 12px; font-weight: 500; }
  .images { display: flex; gap: 12px; overflow-x: auto; }
  .images > div { flex: 1; min-width: 0; }
  .images h3 { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  .images img { width: 100%; border: 1px solid #333; border-radius: 4px; }
</style>
</head><body>
<h1>Screenshot Diff Report</h1>
${cards}
</body></html>`;

const reportPath = path.join(resultsDir, 'screenshot-diff-report.html');
fs.writeFileSync(reportPath, html);
console.log(`\nReport: ${reportPath}`);
