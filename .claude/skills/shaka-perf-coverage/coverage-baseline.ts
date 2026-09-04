#!/usr/bin/env node
// The one command you run. A snapshot is a directory under `coverage-baselines/`.
//
//   save "<sources>"        write a finished snapshot from the latest audit run: code coverage
//                           per statement AND what a screenshot showed of each element
//   list                    which snapshots exist
//   diff [<older> <newer>]  compare two, newest pair by default
//
// The loop: save the BEFORE, make your change, re-audit, save the AFTER, diff. The only input
// is the source list; everything else is read off the run.
//
// AUDIT_ROOT points `save` at a run stashed elsewhere, which is how you snapshot a control side
// after its `audit-results/` has been overwritten.
//
// A snapshot is one file per source, mirroring its path under `app/javascript`, plus
// `legend.txt`. Every line is the source line with its measurements appended:
//
//   return (                                //  C+D        |
//     <Chip label="Featured" />             //             | C=100%,D=0%
//     <div className="slide">               //             | C=33%:clipped-by-ancestor,D=100%
//
// Source first, so the left of `//` is byte-identical between runs of the same commit;
// metadata last, so nothing a measurement does can push a source line sideways; the coverage
// field padded to the widest gutter in the RUN, so the `|` never moves. Together those make a
// diff show only the cells that actually changed.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIR = 'coverage-baselines';
const ROOT = 'app/javascript';
const HEADER = '# sources: ';
const results = (): string => process.env.AUDIT_ROOT || 'audit-results';

// --- the line format ----------------------------------------------------------------------

interface LineParts { head: string; cover: string; source: string }

/** `{ head, cover, source }` for a grid line, or null. Splits on the LAST `|` and the `//`
 *  before it, because the source to their left is full of both. */
const splitLine = (line: string): LineParts | null => {
  const bar = line.lastIndexOf('|');
  if (bar === -1) return null;
  const slash = line.lastIndexOf('//', bar);
  if (slash === -1) return null;
  return { head: line.slice(0, bar + 1), cover: line.slice(slash + 2, bar).trim(), source: line.slice(0, slash) };
};

const seenOf = (line: string): string => {
  const bar = line.lastIndexOf('|');
  return bar === -1 ? '' : line.slice(bar + 1).trim();
};

interface Tally { seen: number; blind: number; statements: number; covered: number }

/** Screenshot cells first — they are the answer; statements are the supporting signal. A cell
 *  is `A=33%` or `A=33%:reason`; parseInt reads the number off either. */
const tally = (text: string): Tally => {
  const lines = text.split('\n');
  const cells = lines.flatMap((l) => seenOf(l).split(',').filter(Boolean));
  const pct = (c: string) => parseInt(c.split('=')[1], 10);
  const cover = (l: string) => (splitLine(l) || { cover: '' }).cover;
  return {
    seen: cells.filter((c) => pct(c) > 0).length,
    blind: cells.filter((c) => pct(c) === 0).length,
    statements: lines.filter((l) => cover(l) !== '').length,
    covered: lines.filter((l) => cover(l) !== '' && cover(l) !== '0').length,
  };
};

// --- code coverage: the scaffold, from each unit's coverage.json ----------------------------

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: any) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : [full];
});

// A, B ... Z, AA, AB ...
const label = (index: number): string => {
  let n = index;
  let out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
};

function buildScaffold(patterns: string[], resultsDir: string, outDir: string): number {
  const res = patterns.map((p) => new RegExp(p));
  // Discover from the tree rather than trusting the pattern to name real files, so a file
  // that matches but never appears in coverage reads as a genuine hole.
  const sources = walk(ROOT).map((f) => path.relative(ROOT, f))
    .filter((rel) => res.some((re) => re.test(rel)))
    .filter((rel) => !/\.(test|spec|stories)\./.test(rel)) // never in browser coverage
    .sort();
  if (!sources.length) throw new Error(`no file under ${ROOT} matched: ${patterns.join(', ')}`);

  // audit-results keeps a directory per run and the names are not chronological, so trust
  // only report.json — otherwise an old run's coverage leaks into the letters.
  const report = JSON.parse(fs.readFileSync(path.join(resultsDir, 'report.json'), 'utf8'));
  const per = new Map<string, { map: any; tests: Map<string, Set<string>> }>(
    sources.map((s) => [s, { map: null, tests: new Map() }]),
  );

  for (const { id, name } of report.tests) {
    const cov = path.join(resultsDir, id, 'artifacts', 'coverage.json');
    if (!fs.existsSync(cov)) continue;
    for (const [abs, entry] of Object.entries<any>(JSON.parse(fs.readFileSync(cov, 'utf8')))) {
      const source = sources.find((s) => abs.endsWith(s));
      if (!source) continue;
      const rec = per.get(source)!;
      rec.map = rec.map || entry.statementMap;
      for (const [statement, count] of Object.entries<number>(entry.s)) {
        if (!count) continue;
        if (!rec.tests.has(statement)) rec.tests.set(statement, new Set());
        rec.tests.get(statement)!.add(name);
      }
    }
  }

  const covering = new Set<string>();
  for (const { tests } of per.values()) for (const names of tests.values()) names.forEach((n) => covering.add(n));
  const letters = new Map([...covering].sort().map((name, i) => [label(i), name]));
  const letterOf = new Map([...letters].map(([l, name]) => [name, l]));

  const gutters = (rec: { map: any; tests: Map<string, Set<string>> }) => {
    const byLine = new Map<number, Set<string>>();
    for (const [statement, { start }] of Object.entries<any>(rec.map)) {
      if (!byLine.has(start.line)) byLine.set(start.line, new Set());
      const names = rec.tests.get(statement);
      if (names) names.forEach((n) => byLine.get(start.line)!.add(letterOf.get(n)!));
    }
    return new Map([...byLine].map(([line, m]) => [line, m.size ? [...m].sort().join('+') : '0']));
  };

  const all = sources.flatMap((s) => (per.get(s)!.map ? [...gutters(per.get(s)!).values()] : []));
  const width = Math.max(1, ...all.map((g) => g.length));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'legend.txt'), `${[
    `${HEADER}${patterns.join(',')}`,
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
    const rec = per.get(source)!;
    const dest = path.join(outDir, source);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!rec.map) { fs.writeFileSync(dest, 'never loaded\n'); continue; }
    const byLine = gutters(rec);
    const text = fs.readFileSync(path.join(ROOT, source), 'utf8').split('\n');
    const srcWidth = Math.max(0, ...text.map((t) => t.length));
    fs.writeFileSync(dest, `${text.map((line, i) => (
      `${line.padEnd(srcWidth)}  // ${(byLine.get(i + 1) || '').padEnd(width)} | `
    )).join('\n')}\n`);
  }
  return sources.length;
}

// --- screenshot coverage: the cells, from each unit's visibility map -------------------------
//
// The maps score every element of a finished page against the test's capture region and —
// when the audit ran with `codeCoverage.screenshotCoveragePlugin` against a development build
// — end each row in `@ path:line[:col]`, where in the app source the element was written.
// That is the join: source line → the tests whose screenshots showed the element, and how much.
// A cell lands on the ELEMENT's own line, one per test that executed the statement drawing it,
// with the MAX across that test's viewports — coverage asks whether ANY screenshot shows the
// element. `0%` is a test that ran the code and showed none of it. Below 100%, the map's
// dominant reason rides along.

interface MapRow { pct: number; reason: string | null; path: string; line: number }
interface Maps { byTest: Map<string, MapRow[]>; maps: number; located: number }

// `<indent> tag selector => x,y,w,h N% visible (reason) @ path:line:col`; reason and source optional.
const ROW = /^(.*?)=>\s*[-\d.,]+\s+(\d+)% visible(?: \(([^)]*)\))?(?: @ (\S+?):(\d+)(?::(\d+))?)?\s*$/;

/** Every located row of the run, pooled per test (one test has one map per viewport). */
function readMaps(resultsDir: string): Maps {
  const reportPath = path.join(resultsDir, 'report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`no ${reportPath} — run \`shaka-perf audit --categories code_coverage\` first`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const byTest = new Map<string, MapRow[]>();
  let maps = 0;
  let located = 0;
  for (const { id, name } of report.tests) {
    const file = path.join(resultsDir, id, 'artifacts', 'visibility-map.txt');
    if (!fs.existsSync(file)) continue;
    maps += 1;
    if (!byTest.has(name)) byTest.set(name, []);
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.startsWith('#') ? null : ROW.exec(line);
      if (!m || !m[4]) continue;
      located += 1;
      byTest.get(name)!.push({ pct: Number(m[2]), reason: m[3] || null, path: m[4], line: Number(m[5]) });
    }
  }
  return { byTest, maps, located };
}

/** A run that cannot carry screenshot cells is refused outright: a snapshot with code coverage
 *  alone is the wrong measurement wearing the right name, and a later diff against it reads as
 *  regression. */
function assertMapsUsable(maps: Maps, resultsDir: string): void {
  if (!maps.maps) throw new Error(`no visibility maps under ${resultsDir} — audit with --categories code_coverage`);
  if (!maps.located) {
    throw new Error(
      `the maps under ${resultsDir} name no element sources, so screenshot coverage cannot be estimated. ` +
      'Set codeCoverage.screenshotCoveragePlugin in abtests.config.ts and audit a DEVELOPMENT build; ' +
      'each map\'s "# source plugin" header says why nothing was located.',
    );
  }
}

const readLegend = (snapshotDir: string): Map<string, string> => {
  const letters = new Map<string, string>();
  for (const line of fs.readFileSync(path.join(snapshotDir, 'legend.txt'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z]+) = (.+)$/);
    if (m) letters.set(m[1], m[2]);
  }
  return letters;
};

/** The snapshot's source files, absolute. */
const snapshotFiles = (dir: string): string[] => walk(dir).filter((f) => path.basename(f) !== 'legend.txt');

// A map row's path is bundle-relative (`app/javascript/consumer/Nav.tsx`); a snapshot file is
// relative to app/javascript (`consumer/Nav.tsx`).
const namesFile = (rowPath: string, file: string): boolean => rowPath === file || rowPath.endsWith(`/${file}`);

// A JSX line starts no statement, so its coverage field is blank: the letters come from the
// nearest covered statement above it — usually the `return (` that drew the element, sometimes
// a module-level `const items = [{ icon: <Icon /> }]` whose element a component rendered later.
// Either way a row exists only because the element reached the DOM, so the statement's letters
// are exactly the tests that could have shown it.
const attach = (lines: string[], lineNo: number): number | null => {
  for (let n = lineNo; n > 0; n -= 1) {
    const parts = splitLine(lines[n - 1] || '');
    if (parts && parts.cover && parts.cover !== '0') return n - 1;
  }
  return null;
};

const slug = (reason: string): string => reason.replace(/\s+/g, '-');

function fillScreenshotCells(snapshotDir: string, maps: Maps): { cells: number; elements: number; unattached: number } {
  const letters = readLegend(snapshotDir);
  const letterOf = new Map([...letters].map(([letter, name]) => [name, letter]));
  const stats = { cells: 0, elements: 0, unattached: 0 };

  for (const full of snapshotFiles(snapshotDir)) {
    const file = path.relative(snapshotDir, full);
    const lines = fs.readFileSync(full, 'utf8').split('\n');

    // element line → letter → the best row of that test (max percentage across its viewports)
    const seenByLine = new Map<number, Map<string, MapRow>>();
    for (const [test, rows] of maps.byTest) {
      const letter = letterOf.get(test);
      if (!letter) continue; // this test executed none of the snapshot's sources
      for (const row of rows) {
        if (!namesFile(row.path, file)) continue;
        if (!seenByLine.has(row.line)) seenByLine.set(row.line, new Map());
        const seen = seenByLine.get(row.line)!;
        const best = seen.get(letter);
        if (!best || row.pct > best.pct) seen.set(letter, row);
      }
    }

    let touched = false;
    for (const [lineNo, seen] of seenByLine) {
      const here = splitLine(lines[lineNo - 1] || '');
      const at = attach(lines, lineNo);
      if (!here || at === null) { stats.unattached += 1; continue; }
      // Only the letters of the statement that drew the element: a test that never executed
      // the code cannot have rendered it. One that did but whose screenshots showed none of
      // it is a measured 0% — the hole this whole exercise exists to find.
      const cells = splitLine(lines[at])!.cover.split('+').map((letter) => {
        const best = seen.get(letter);
        const pct = best ? best.pct : 0;
        const why = best && pct < 100 && best.reason ? `:${slug(best.reason)}` : '';
        return `${letter}=${pct}%${why}`;
      });
      lines[lineNo - 1] = `${here.head} ${cells.sort().join(',')}`;
      stats.cells += cells.length;
      stats.elements += 1;
      touched = true;
    }
    if (touched) fs.writeFileSync(full, lines.join('\n'));
  }
  return stats;
}

// --- commands -----------------------------------------------------------------------------

// `.diff` folders live alongside the snapshots; they are results, not snapshots.
const snapshots = (): string[] => (fs.existsSync(DIR) ? fs.readdirSync(DIR, { withFileTypes: true }) : [])
  .filter((e: any) => e.isDirectory() && !e.name.endsWith('.diff'))
  .map((e: any) => e.name).sort()
  .map((name: string) => path.join(DIR, name));

const sourcesOf = (dir: string): string => {
  const legend = path.join(dir, 'legend.txt');
  if (!fs.existsSync(legend)) throw new Error(`${dir} has no legend.txt — not a snapshot`);
  return fs.readFileSync(legend, 'utf8').split('\n')[0].slice(HEADER.length);
};

const totalOf = (dir: string): Tally => snapshotFiles(dir)
  .map((f) => tally(fs.readFileSync(f, 'utf8')))
  .reduce((a, b) => ({
    seen: a.seen + b.seen, blind: a.blind + b.blind,
    statements: a.statements + b.statements, covered: a.covered + b.covered,
  }), { seen: 0, blind: 0, statements: 0, covered: 0 });

function save(sources: string): void {
  if (!sources) throw new Error('save needs a source regex list, e.g. save "HorizonNav/.*\\.tsx"');
  // Read the maps before writing anything: a run that cannot carry screenshot cells leaves no
  // half-snapshot behind to be mistaken for a baseline.
  const maps = readMaps(results());
  assertMapsUsable(maps, results());

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dir = path.join(DIR, stamp);
  const patterns = sources.split(',').map((s) => s.trim()).filter(Boolean);
  const count = buildScaffold(patterns, results(), dir);
  const cells = fillScreenshotCells(dir, maps);
  const t = totalOf(dir);
  console.log(`saved ${dir} — ${count} sources, ${cells.elements} element lines: ${t.seen} seen, ${t.blind} at 0%`);
  if (cells.unattached) {
    console.log(`  ${cells.unattached} element line(s) sit under no covered statement — the source on disk `
      + 'may not be the source the server was built from');
  }
}

function list(): void {
  const all = snapshots();
  if (!all.length) { console.log(`no snapshots yet — run \`save "<sources>"\``); return; }
  for (const dir of all) {
    const t = totalOf(dir);
    console.log(`${dir}  ${snapshotFiles(dir).length} files  ${t.seen} seen, ${t.blind} at 0%  |  ${t.covered}/${t.statements} statements`);
  }
}

function diff(older?: string, newer?: string): void {
  const all = snapshots();
  const before = older || all.at(-2);
  const after = newer || all.at(-1);
  if (!before || !after || before === after) throw new Error('need two snapshots to compare');
  for (const dir of [before, after]) if (!fs.existsSync(dir)) throw new Error(`no such snapshot: ${dir}`);
  if (sourcesOf(before) !== sourcesOf(after)) {
    console.error('warning: saved with different sources — the diff is not comparable');
  }

  const outDir = `${after}--vs--${path.basename(before)}.diff`;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const rel = (dir: string, f: string) => path.relative(dir, f);
  const beforeFiles = new Map(snapshotFiles(before).map((f) => [rel(before, f), f]));
  const afterFiles = new Map(snapshotFiles(after).map((f) => [rel(after, f), f]));

  const rows: Array<{ move: number; line: string }> = [];
  let changed = 0;

  for (const key of [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort()) {
    const a = beforeFiles.get(key);
    const b = afterFiles.get(key);
    if (!a || !b) { rows.push({ move: Infinity, line: `${!a ? 'ADDED' : 'REMOVED'} ${key}` }); continue; }

    let body = '';
    try {
      execFileSync('diff', ['-u', '--label', `${before}/${key}`, '--label', `${after}/${key}`, a, b], { encoding: 'utf8' });
    } catch (err: any) { body = err.stdout || ''; }

    // One .diff per CHANGED source only: the listing is then the index — `ls` names what
    // moved. Writing empty files for unchanged sources would destroy exactly that.
    if (body) {
      changed += 1;
      const dest = path.join(outDir, `${key}.diff`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body);
    }

    const x = tally(fs.readFileSync(a, 'utf8'));
    const y = tally(fs.readFileSync(b, 'utf8'));
    const mark = (n: number) => (n === 0 ? '   ' : (n > 0 ? `+${n}`.padEnd(3) : `${n}`.padEnd(3)));
    rows.push({
      // Screenshot movement dominates the ordering; statements only break ties.
      move: Math.abs(y.seen - x.seen) * 1000 + Math.abs(y.covered - x.covered),
      line: `${String(x.seen).padStart(3)} ->${String(y.seen).padStart(4)} ${mark(y.seen - x.seen)}`
        + ` ${String(y.blind).padStart(3)}  |`
        + ` ${String(x.covered).padStart(4)} ->${String(y.covered).padStart(5)} of ${String(y.statements).padEnd(4)} ${mark(y.covered - x.covered)}`
        + `  ${body ? '' : '(no diff) '}${key}`,
    });
  }

  const x = totalOf(before);
  const y = totalOf(after);
  const out = [
    `# before: ${before}`,
    `# after:  ${after}`,
    '#',
    '# THE GOAL IS SCREENSHOT COVERAGE. Code coverage only says a test EXECUTED the code,',
    '# never that a picture shows it. Lead any report with the left block.',
    '#',
    `# TOTAL  ${x.seen} -> ${y.seen} seen  (${y.blind} at 0%)   |   ${x.covered} -> ${y.covered} statements`,
    '#',
    '#  seen ->seen   d  0%   |   cov ->  cov of stmt  d   source',
    '#',
    ...rows.sort((p, q) => q.move - p.move).map((r) => r.line),
  ].join('\n');

  fs.writeFileSync(path.join(outDir, 'summary.txt'), `${out}\n`);
  console.log(out);
  console.log(`\n${changed} of ${afterFiles.size} sources changed — per-source diffs in ${outDir}/`);
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, () => void> = {
  diff: () => diff(rest[0], rest[1]),
  list,
  save: () => save(rest[0]),
};

if (!commands[command]) {
  console.log('usage: coverage-baseline.ts save "<sources>" | list | diff [<older> <newer>]');
  process.exit(1);
}

try {
  commands[command]();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
