#!/usr/bin/env node
// Prints each matching source with the tests that executed every line, as letters keyed to
// a legend. Reads the Istanbul coverage `shaka-perf audit` leaves in audit-results.
//
//   node view-coverage.js "consumer/menus/NextMenuGroupTabs\.jsx"
//   node view-coverage.js "HorizonNav/.*\.tsx,NextMenuGroup.*\.jsx"
//
// Sources are comma-separated regexes matched against paths under app/javascript. A gutter
// of 0 is a statement no test reached; a blank gutter means no statement starts on that
// line. The letters say which test covered what, so there is nothing to filter.

const fs = require('fs');
const path = require('path');

const RESULTS = 'audit-results';
const ROOT = 'app/javascript';

const patterns = process.argv.slice(2)
  .filter(a => !a.startsWith('--'))
  .flatMap(a => a.split(',')).map(s => s.trim()).filter(Boolean);

if (!patterns.length) {
  console.log('usage: view-coverage.js <source-regex>,...');
  process.exit(1);
}
const sourceRes = patterns.map(p => new RegExp(p));

// Discover sources from the tree rather than trusting the pattern to name real files, so a
// file that matches but never appears in coverage can be reported as a genuine hole.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : [full];
});
const sources = walk(ROOT)
  .map(f => path.relative(ROOT, f))
  .filter(rel => sourceRes.some(re => re.test(rel)))
  // Jest files never appear in browser coverage, so they would always read as holes.
  .filter(rel => !/\.(test|spec|stories)\./.test(rel))
  .sort();

if (!sources.length) {
  console.log(`no file under ${ROOT} matched: ${patterns.join(', ')}`);
  process.exit(1);
}

// audit-results keeps a directory per run and the names are not chronological, so read
// only the run report.json names — otherwise old runs' coverage leaks into the letters.
const report = JSON.parse(fs.readFileSync(path.join(RESULTS, 'report.json'), 'utf8'));

const perSource = new Map(sources.map(s => [s, { map: null, testsByStatement: new Map() }]));

for (const { id, name } of report.tests) {
  const covPath = path.join(RESULTS, id, 'artifacts', 'coverage.json');
  if (!fs.existsSync(covPath)) continue;

  for (const [absPath, entry] of Object.entries(JSON.parse(fs.readFileSync(covPath, 'utf8')))) {
    const source = sources.find(s => absPath.endsWith(s));
    if (!source) continue;
    const rec = perSource.get(source);
    rec.map = rec.map || entry.statementMap;
    for (const [statement, count] of Object.entries(entry.s)) {
      if (!count) continue;
      if (!rec.testsByStatement.has(statement)) rec.testsByStatement.set(statement, new Set());
      rec.testsByStatement.get(statement).add(name);
    }
  }
}

// A, B ... Z, AA, AB ...
const label = (index) => {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
};

// One legend for the whole run, over every test that covered something being printed.
const covering = new Set();
for (const { testsByStatement } of perSource.values()) {
  for (const tests of testsByStatement.values()) tests.forEach(t => covering.add(t));
}
const letters = new Map([...covering].sort().map((name, i) => [label(i), name]));
const letterOf = new Map([...letters].map(([letter, name]) => [name, letter]));

for (const [letter, name] of letters) console.log(`${letter} = ${name}`);
if (!letters.size) console.log('(no test in this run covered the matched sources)');

// line -> "A+B+C", or "0" when the line holds a statement nobody ran
function gutters(rec) {
  const byLine = new Map();
  for (const [statement, { start }] of Object.entries(rec.map)) {
    if (!byLine.has(start.line)) byLine.set(start.line, new Set());
    const marks = byLine.get(start.line);
    const tests = rec.testsByStatement.get(statement);
    if (tests) tests.forEach(t => marks.add(letterOf.get(t)));
  }
  return new Map([...byLine].map(([line, marks]) => [
    line, marks.size ? [...marks].sort().join('+') : '0',
  ]));
}

for (const source of sources) {
  const rec = perSource.get(source);
  console.log(`\n=== ${source}`);

  if (!rec.map) {
    console.log('  never loaded');
    continue;
  }

  const byLine = gutters(rec);
  const width = Math.max(1, ...[...byLine.values()].map(g => g.length));
  fs.readFileSync(path.join(ROOT, source), 'utf8').split('\n').forEach((text, i) => {
    console.log(`  ${(byLine.get(i + 1) || '').padEnd(width)} │ ${text}`);
  });
}
