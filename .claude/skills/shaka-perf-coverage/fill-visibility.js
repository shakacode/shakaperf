// Fills the screenshot field of a snapshot from its anchors file. Run via
// `coverage-baseline.ts fill <snapshot-dir>`.
//
// The split of labour is the point. ANCHORING is judgement and stays yours: only a reader
// can say `<FeaturedMenuItemCard>` comes out as `.featured-item-dish-card`. Write it down
// once, in `<snapshot-dir>/anchors.json`. Everything after — finding the statement the
// element belongs to, grepping sixty-odd maps, taking the max across viewports — is
// transcription, and transcription by hand across tens of thousands of map lines is how
// numbers get invented.
//
//   {
//     "consumer/menus/FeaturedMenuItemCard/FeaturedMenuItemCard.jsx": {
//       "123": "\\.featured-item-dish-card"
//     },
//     "consumer/menus/CompactMenuSection/CompactMenuSection.tsx": { "84": "?" }
//   }
//
// source path → SOURCE LINE of the element → regex matched against a map row's
// `tag [data-*],#id,.class`. `"?"` means the component has no stable hook at all — a finding
// about the component, recorded rather than guessed at. Anchors persist with the snapshot,
// so the next run is a re-grep instead of a re-think: copy the file forward and run again.

const fs = require('fs');
const path = require('path');
const { splitLine } = require('./snapshot');

function fill(snapshotDir, resultsDir) {
  const anchorsPath = path.join(snapshotDir, 'anchors.json');
  if (!fs.existsSync(anchorsPath)) {
    throw new Error(`no ${anchorsPath} — write the anchors first; they are the part only you can supply`);
  }
  const anchors = JSON.parse(fs.readFileSync(anchorsPath, 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(resultsDir, 'report.json'), 'utf8'));

  // One test has one map per viewport; pool them, because coverage asks whether ANY
  // screenshot shows the element.
  const byTest = new Map();
  for (const { id, name } of report.tests) {
    const file = path.join(resultsDir, id, 'artifacts', 'visibility-map.txt');
    if (!fs.existsSync(file)) continue;
    if (!byTest.has(name)) byTest.set(name, []);
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^(.*?)=>\s*[-\d.,]+\s+(\d+)% visible/);
      if (m) byTest.get(name).push({ selector: m[1].trim(), pct: +m[2] });
    }
  }
  if (!byTest.size) throw new Error(`no visibility maps under ${resultsDir} — audit with --categories code_coverage`);

  const letters = new Map();
  for (const line of fs.readFileSync(path.join(snapshotDir, 'legend.txt'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z]+) = (.+)$/);
    if (m) letters.set(m[1], m[2]);
  }

  const every = [...byTest.values()].flat().map(r => r.selector);
  const unresolved = new Set();

  const cellFor = (cover, anchor) => {
    const marks = cover.split('+');
    if (anchor === '?') return marks.map(l => `${l}=?`).join(',');
    const re = new RegExp(anchor);
    // An anchor matching nothing in the whole run is likelier wrong than describing an
    // element nothing renders, so it stays `?` and is reported. Once it matches ANYWHERE,
    // absence from one test is a measurement — that test's screenshots showed none of it,
    // and `?` there would hide a real hole behind "unknown".
    const resolves = every.some(sel => re.test(sel));
    if (!resolves) unresolved.add(anchor);
    return marks.map((letter) => {
      const hits = (byTest.get(letters.get(letter)) || []).filter(r => re.test(r.selector));
      return `${letter}=${hits.length ? `${Math.max(...hits.map(h => h.pct))}%` : (resolves ? '0%' : '?')}`;
    }).join(',');
  };

  let written = 0;
  let unattached = 0;
  const missing = [];

  for (const [source, byLineNo] of Object.entries(anchors)) {
    if (source.startsWith('_')) continue;
    const file = path.join(snapshotDir, source);
    if (!fs.existsSync(file)) { missing.push(source); continue; }
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    for (const [lineNo, anchor] of Object.entries(byLineNo)) {
      // A bare JSX line starts no statement, so its coverage field is blank. Walk up to the
      // nearest RENDERED statement — the `return (` that draws the element.
      //
      // `rendered` is what makes the result mean anything. A module-level line is covered
      // the moment its chunk is fetched, so anchoring there yields a letter per test that
      // merely imported the component and a `?` for every one of them. Those cells are
      // noise: we only look up things that were actually rendered.
      let at = null;
      for (let n = Number(lineNo); n > 0 && n > Number(lineNo) - 60; n -= 1) {
        const parts = splitLine(lines[n - 1] || '');
        if (parts && parts.rendered && parts.cover && parts.cover !== '0') { at = n - 1; break; }
      }
      if (at === null) { unattached += 1; continue; }
      const parts = splitLine(lines[at]);
      const existing = lines[at].slice(parts.head.length).trim();
      const cell = cellFor(parts.cover, anchor);
      lines[at] = `${parts.head} ${existing ? `${existing},${cell}` : cell}`;
      written += 1;
    }
    fs.writeFileSync(file, lines.join('\n'));
  }

  return { written, unattached, missing, unresolved: [...unresolved] };
}

module.exports = { fill };
