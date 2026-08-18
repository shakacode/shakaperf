// The snapshot format, and the code that writes one.
//
// A snapshot is a directory: one file per source, mirroring its path under `app/javascript`,
// plus `legend.txt`. Every line is the source line with its coverage appended:
//
//   const CompactMenuCarousel = ({ children }) => {   // C+D        | C=100%,D=100%
//                                                        ^code        ^screenshot
//
// Source first so the left of `//` is byte-identical between runs of the same commit;
// metadata last so nothing a measurement does can push a source line sideways; the coverage
// field padded to the widest gutter in the RUN so the `|` never moves. Together those make a
// diff show only the cells that actually changed.

const fs = require('fs');
const path = require('path');

const ROOT = 'app/javascript';

// --- the line format, shared with fill-visibility.js and coverage-baseline.ts -------------

/** `{ head, cover, source, rendered }` for a grid line, or null. Splits on the LAST `|` and
 *  the `//` before it, because the source to their left is full of both.
 *
 *  `rendered` marks a statement INSIDE a function body — one that runs per render. A
 *  top-level statement is covered as soon as the module is evaluated, which happens when its
 *  chunk is fetched, so its letters say nothing about whether anything was drawn. */
const splitLine = (line) => {
  const bar = line.lastIndexOf('|');
  if (bar === -1) return null;
  const slash = line.lastIndexOf('//', bar);
  if (slash === -1) return null;
  const source = line.slice(0, slash);
  return {
    head: line.slice(0, bar + 1),
    cover: line.slice(slash + 2, bar).trim(),
    source,
    rendered: /^\s/.test(source) && source.trim() !== '',
  };
};

const seenOf = (line) => {
  const bar = line.lastIndexOf('|');
  return bar === -1 ? '' : line.slice(bar + 1).trim();
};

/** Screenshot cells first — they are the answer; statements are the supporting signal. */
const tally = (text) => {
  const lines = text.split('\n');
  const cells = lines.flatMap(l => seenOf(l).split(',').filter(Boolean));
  const pct = c => c.split('=')[1];
  const cover = l => (splitLine(l) || { cover: '' }).cover;
  return {
    seen: cells.filter(c => pct(c) !== '?' && parseInt(pct(c), 10) > 0).length,
    blind: cells.filter(c => pct(c) !== '?' && parseInt(pct(c), 10) === 0).length,
    unknown: cells.filter(c => pct(c) === '?').length,
    statements: lines.filter(l => cover(l) !== '').length,
    covered: lines.filter(l => cover(l) !== '' && cover(l) !== '0').length,
  };
};

// --- building a scaffold -----------------------------------------------------------------

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : [full];
});

// A, B ... Z, AA, AB ...
const label = (index) => {
  let n = index;
  let out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
};

function build(patterns, resultsDir, outDir) {
  const res = patterns.map(p => new RegExp(p));
  // Discover from the tree rather than trusting the pattern to name real files, so a file
  // that matches but never appears in coverage reads as a genuine hole.
  const sources = walk(ROOT).map(f => path.relative(ROOT, f))
    .filter(rel => res.some(re => re.test(rel)))
    .filter(rel => !/\.(test|spec|stories)\./.test(rel)) // never in browser coverage
    .sort();
  if (!sources.length) throw new Error(`no file under ${ROOT} matched: ${patterns.join(', ')}`);

  // audit-results keeps a directory per run and the names are not chronological, so trust
  // only report.json — otherwise an old run's coverage leaks into the letters.
  const report = JSON.parse(fs.readFileSync(path.join(resultsDir, 'report.json'), 'utf8'));
  const per = new Map(sources.map(s => [s, { map: null, tests: new Map() }]));

  for (const { id, name } of report.tests) {
    const cov = path.join(resultsDir, id, 'artifacts', 'coverage.json');
    if (!fs.existsSync(cov)) continue;
    for (const [abs, entry] of Object.entries(JSON.parse(fs.readFileSync(cov, 'utf8')))) {
      const source = sources.find(s => abs.endsWith(s));
      if (!source) continue;
      const rec = per.get(source);
      rec.map = rec.map || entry.statementMap;
      for (const [statement, count] of Object.entries(entry.s)) {
        if (!count) continue;
        if (!rec.tests.has(statement)) rec.tests.set(statement, new Set());
        rec.tests.get(statement).add(name);
      }
    }
  }

  const covering = new Set();
  for (const { tests } of per.values()) for (const names of tests.values()) names.forEach(n => covering.add(n));
  const letters = new Map([...covering].sort().map((name, i) => [label(i), name]));
  const letterOf = new Map([...letters].map(([l, name]) => [name, l]));

  const gutters = (rec) => {
    const byLine = new Map();
    for (const [statement, { start }] of Object.entries(rec.map)) {
      if (!byLine.has(start.line)) byLine.set(start.line, new Set());
      const names = rec.tests.get(statement);
      if (names) names.forEach(n => byLine.get(start.line).add(letterOf.get(n)));
    }
    return new Map([...byLine].map(([line, m]) => [line, m.size ? [...m].sort().join('+') : '0']));
  };

  const all = sources.flatMap(s => (per.get(s).map ? [...gutters(per.get(s)).values()] : []));
  const width = Math.max(1, ...all.map(g => g.length));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'legend.txt'), `${[
    `# sources: ${patterns.join(',')}`,
    `# audit: ${path.resolve(resultsDir)}`,
    '#',
    '# format:  <source line>  // <tests that executed it> | <what a screenshot showed>',
    '#   THE GOAL IS THE RIGHT FIELD. The left one only says a test ran the code.',
    '#   0 = a statement no test reached; blank = no statement starts here.',
    '#',
    ...[...letters].map(([l, name]) => `${l} = ${name}`),
    ...(letters.size ? [] : ['(no test in this run covered the matched sources)']),
  ].join('\n')}\n`);

  for (const source of sources) {
    const rec = per.get(source);
    const dest = path.join(outDir, source);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!rec.map) { fs.writeFileSync(dest, 'never loaded\n'); continue; }
    const byLine = gutters(rec);
    const text = fs.readFileSync(path.join(ROOT, source), 'utf8').split('\n');
    const srcWidth = Math.max(0, ...text.map(t => t.length));
    fs.writeFileSync(dest, `${text.map((line, i) => (
      `${line.padEnd(srcWidth)}  // ${(byLine.get(i + 1) || '').padEnd(width)} | `
    )).join('\n')}\n`);
  }
  return sources.length;
}

module.exports = { build, splitLine, seenOf, tally, ROOT };
