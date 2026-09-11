#!/usr/bin/env node
// save "<sources>" | list | diff [<older> <newer>]  — see SKILL.md for the loop and how to read
// a snapshot. AUDIT_ROOT points `save` at a run stashed elsewhere.
//
// A snapshot is one file per source under `audit-results/coverage-baselines/<stamp>/`, plus a
// `legend.txt`. Each line is the source line, then `// <tests that executed it> | <what a
// screenshot showed>`: source first so the left of `//` is byte-identical between runs of the
// same commit, the gutter padded to the widest in the run so the `|` never moves — a diff then
// shows only the cells that changed.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DIR = path.join('audit-results', 'coverage-baselines');
const ROOT = 'app/javascript';
const AUDIT = process.env.AUDIT_ROOT || 'audit-results';
const SOURCES = '# sources: ';
const NOTE = '# screenshot column: ';

interface Test { id: string; name: string; outcomes: Array<{ kind: string; stage?: string }> }
interface Tally { seen: number; blind: number; statements: number; covered: number }
interface Row { pct: number; reason: string | null; path: string; line: number }
/** A grid line split at its markers: the source (with `//`), the code gutter, the screenshot cells. */
interface Parsed { head: string; cover: string; seen: string }
/** The slice of an istanbul per-file entry this script reads. */
interface FileCoverage { statementMap: Record<string, { start: { line: number } }>; s: Record<string, number> }

const read = (file: string): string[] => fs.readFileSync(file, 'utf8').split('\n');
const files = (dir: string): string[] => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
const sourceFiles = (dir: string): string[] => files(dir).filter((f) => path.basename(f) !== 'legend.txt');
const artifact = (test: Test, name: string): string => path.join(AUDIT, test.id, 'artifacts', name);
function at<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}
// A, B … Z, AA, AB …
const label = (i: number): string => (i < 26 ? '' : label(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26));

// --- the line format ----------------------------------------------------------------------

// Splits on the LAST `|` and the `//` before it, because the source to their left is full of both.
const parse = (line: string): Parsed | null => {
  const bar = line.lastIndexOf('|');
  const slash = line.lastIndexOf('//', bar);
  if (bar === -1 || slash === -1) return null;
  return { head: line.slice(0, bar + 1), cover: line.slice(slash + 2, bar).trim(), seen: line.slice(bar + 1).trim() };
};

// Screenshot cells (`A=33%[:reason]`) first — they are the answer; statements are the supporting
// signal. A not-estimated note in the same field is not a cell.
const tally = (lines: string[]): Tally => {
  const parts = lines.flatMap((l) => parse(l) ?? []);
  const pcts = parts.flatMap((p) => p.seen.split(',')).flatMap((c) => /^[A-Z]+=(\d+)%/.exec(c)?.[1] ?? []).map(Number);
  const statements = parts.filter((p) => p.cover);
  const seen = pcts.filter(Boolean).length;
  return {
    seen,
    blind: pcts.length - seen,
    statements: statements.length,
    covered: statements.filter((p) => p.cover !== '0').length,
  };
};
const totalOf = (dir: string): Tally => tally(sourceFiles(dir).flatMap(read));

const legendOf = (dir: string): { sources: string; note: string | null } => {
  const file = path.join(dir, 'legend.txt');
  if (!fs.existsSync(file)) throw new Error(`${dir} has no legend.txt — not a snapshot`);
  const lines = read(file);
  return { sources: lines[0].slice(SOURCES.length), note: lines.find((l) => l.startsWith(NOTE))?.slice(NOTE.length) ?? null };
};

// --- code coverage: the scaffold, from each unit's coverage.json ----------------------------

interface Source { map: FileCoverage['statementMap'] | null; tests: Map<string, Set<string>> } // statement id → tests that ran it

// `note`, when the run cannot fill the screenshot column, goes into that column on each
// source's first line and into the legend: a later diff then reads the empty column as "not
// measured", never as a regression.
function scaffold(patterns: string[], dir: string, tests: Test[], note: string | null): { count: number; letterOf: Map<string, string> } {
  const res = patterns.map((p) => new RegExp(p));
  // From the tree, not from the coverage: a file that matches but never appears in coverage is
  // a genuine hole, and test/story files never reach a browser.
  const sources = files(ROOT).map((f) => path.relative(ROOT, f))
    .filter((rel) => res.some((re) => re.test(rel)) && !/\.(test|spec|stories)\./.test(rel)).sort();
  if (!sources.length) throw new Error(`no file under ${ROOT} matched: ${patterns.join(', ')}`);

  const per = new Map<string, Source>(sources.map((s) => [s, { map: null, tests: new Map() }]));
  const covering = new Set<string>();
  for (const test of tests.filter((t) => fs.existsSync(artifact(t, 'coverage.json')))) {
    const coverage = JSON.parse(fs.readFileSync(artifact(test, 'coverage.json'), 'utf8')) as Record<string, FileCoverage>;
    for (const [abs, entry] of Object.entries(coverage)) {
      const source = sources.find((s) => abs.endsWith(s));
      if (!source) continue;
      const rec = per.get(source)!;
      rec.map ??= entry.statementMap;
      for (const [statement, count] of Object.entries(entry.s)) {
        if (!count) continue;
        at(rec.tests, statement, () => new Set<string>()).add(test.name);
        covering.add(test.name);
      }
    }
  }
  const letterOf = new Map([...covering].sort().map((name, i) => [name, label(i)]));

  // line → `A+C` of the tests that executed a statement starting there, `0` when none did
  const gutters = (map: FileCoverage['statementMap'], ran: Source['tests']): Map<number, string> => {
    const byLine = new Map<number, Set<string>>();
    for (const [statement, { start }] of Object.entries(map)) {
      const letters = at(byLine, start.line, () => new Set<string>());
      ran.get(statement)?.forEach((name) => letters.add(letterOf.get(name)!));
    }
    return new Map([...byLine].map(([line, l]) => [line, l.size ? [...l].sort().join('+') : '0']));
  };
  const grids = new Map<string, Map<number, string>>();
  for (const [source, { map, tests: ran }] of per) if (map) grids.set(source, gutters(map, ran));
  const width = Math.max(1, ...[...grids.values()].flatMap((g) => [...g.values()].map((v) => v.length)));

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'legend.txt'), [
    `${SOURCES}${patterns.join(',')}`,
    `# audit: ${path.resolve(AUDIT)}`,
    '#',
    '# format:  <source line>  // <tests that executed it> | <what a screenshot showed>',
    '#   0 = a statement no test reached; blank = no statement starts here.',
    '#',
    ...(letterOf.size ? [...letterOf].map(([name, letter]) => `${letter} = ${name}`) : ['(no test in this run covered the matched sources)']),
    ...(note ? [`${NOTE}${note}`] : []),
    '',
  ].join('\n'));
  for (const source of sources) {
    const dest = path.join(dir, source);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const grid = grids.get(source);
    if (!grid) { fs.writeFileSync(dest, 'never loaded\n'); continue; }
    const text = read(path.join(ROOT, source));
    const srcWidth = Math.max(0, ...text.map((t) => t.length));
    const gridLine = (line: string, i: number): string => `${line.padEnd(srcWidth)}  // ${(grid.get(i + 1) || '').padEnd(width)} | ${i === 0 && note ? note : ''}`;
    fs.writeFileSync(dest, `${text.map(gridLine).join('\n')}\n`);
  }
  return { count: sources.length, letterOf };
}

// --- screenshot coverage: the cells, from each unit's visibility map -------------------------
//
// A map row ends in `@ path:line[:col]` when the audit ran with `audit.screenshotCoveragePlugin`
// against a build it could read: the join from a source line to the tests whose screenshots
// showed the element. A cell lands on the ELEMENT's own line, one per test that executed the
// statement drawing it, with the MAX across that test's viewports — coverage asks whether ANY
// screenshot shows the element. `0%` is a test that ran the code and showed none of it.

// `<indent> tag selector => x,y,w,h N% visible (reason) @ path:line:col`; reason and source optional.
const ROW = /^.*?=>\s*[-\d.,]+\s+(\d+)% visible(?: \(([^)]*)\))?(?: @ (\S+?):(\d+)(?::\d+)?)?\s*$/;
// Written only when a plugin ran, which tells a run without one from a build it could not read.
const PLUGIN = /^# source plugin: (.+?) — \d+ of \d+ elements located/;

/** Every located row of the run, pooled per test (one test has one map per viewport). */
function readMaps(tests: Test[]): { byTest: Map<string, Row[]>; located: boolean; plugin: string | null } {
  const byTest = new Map<string, Row[]>();
  let plugin: string | null = null;
  for (const test of tests.filter((t) => fs.existsSync(artifact(t, 'visibility-map.txt')))) {
    const rows = at(byTest, test.name, (): Row[] => []);
    for (const line of read(artifact(test, 'visibility-map.txt'))) {
      if (line.startsWith('#')) { plugin = PLUGIN.exec(line)?.[1] ?? plugin; continue; }
      const m = ROW.exec(line);
      if (m?.[3]) rows.push({ pct: Number(m[1]), reason: m[2] || null, path: m[3], line: Number(m[4]) });
    }
  }
  return { byTest, located: [...byTest.values()].some((rows) => rows.length), plugin };
}

// A JSX line starts no statement, so its gutter is blank: the letters come from the nearest
// covered statement above it — usually the `return (` that drew the element, sometimes a
// module-level `const items = [{ icon: <Icon /> }]` rendered later. Either way a row exists only
// because the element reached the DOM, so those letters are exactly the tests that could have
// shown it; one that showed none of it is a measured 0% — the hole this exercise exists to find.
function fillCells(dir: string, byTest: Map<string, Row[]>, letterOf: Map<string, string>): { elements: number; unattached: number } {
  const stats = { elements: 0, unattached: 0 };
  // Only a test with a map can have measured anything; a letter without one gets no cell,
  // never a 0%.
  const mapped = new Set([...byTest.keys()].flatMap((name) => letterOf.get(name) ?? []));
  for (const full of sourceFiles(dir)) {
    const file = path.relative(dir, full);
    const lines = read(full);
    // element line → letter → that test's best row (max across its viewports)
    const best = new Map<number, Map<string, Row>>();
    for (const [test, rows] of byTest) {
      const letter = letterOf.get(test);
      if (!letter) continue; // executed none of the snapshot's sources
      // A row's path is bundle-relative (`app/javascript/x/Nav.tsx`); the file is relative to ROOT.
      for (const row of rows.filter((r) => r.path === file || r.path.endsWith(`/${file}`))) {
        const seen = at(best, row.line, () => new Map<string, Row>());
        if ((seen.get(letter)?.pct ?? -1) < row.pct) seen.set(letter, row);
      }
    }
    for (const [lineNo, seen] of best) {
      const here = parse(lines[lineNo - 1] ?? '');
      const statement = lines.slice(0, lineNo).map(parse).findLast((p) => p?.cover && p.cover !== '0');
      if (!here || !statement) { stats.unattached += 1; continue; }
      const cells = statement.cover.split('+').filter((letter) => mapped.has(letter)).map((letter) => {
        const row = seen.get(letter);
        const why = row && row.pct < 100 && row.reason ? `:${row.reason.replace(/\s+/g, '-')}` : '';
        return `${letter}=${row?.pct ?? 0}%${why}`;
      });
      lines[lineNo - 1] = `${here.head} ${cells.sort().join(',')}`;
      stats.elements += 1;
    }
    if (best.size) fs.writeFileSync(full, lines.join('\n'));
  }
  return stats;
}

// --- commands -----------------------------------------------------------------------------

function save(sources?: string): void {
  if (!sources) throw new Error('save needs a source regex list, e.g. save "HorizonNav/.*\\.tsx"');
  const report = path.join(AUDIT, 'report.json');
  if (!fs.existsSync(report)) throw new Error(`no ${report} — run \`shaka-perf audit --categories code_coverage\` first`);
  const { tests: all } = JSON.parse(fs.readFileSync(report, 'utf8')) as { tests: Test[] };
  // Only units whose measurement succeeded: an errored unit may have written coverage.json
  // before its map failed, and its letters would then read as measured 0% holes.
  const tests = all.filter((t) => t.outcomes.some((o) => o.kind === 'ok' && o.stage === 'code_coverage'));
  if (!tests.length) throw new Error(`no successful code_coverage unit in ${report} — audit with --categories code_coverage`);
  const halfMeasured = tests.filter((t) => fs.existsSync(artifact(t, 'coverage.json')) && !fs.existsSync(artifact(t, 'visibility-map.txt')));
  if (halfMeasured.length) {
    throw new Error(`coverage.json without visibility-map.txt for ${halfMeasured.map((t) => t.id).join(', ')} — the screenshot half of the measurement is missing; re-audit`);
  }
  // Maps before anything is written: a run without them leaves no half-snapshot behind.
  const maps = readMaps(tests);
  if (!maps.byTest.size) throw new Error(`no visibility maps under ${AUDIT} — audit with --categories code_coverage`);

  const dir = path.join(DIR, new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
  const patterns = sources.split(',').map((s) => s.trim()).filter(Boolean);
  const note = maps.located ? null
    : `impossible to estimate, ${maps.plugin ? `${maps.plugin} located no elements` : 'no screenshotCoveragePlugin installed'}`;
  const { count, letterOf } = scaffold(patterns, dir, tests, note);
  if (note) {
    console.log(`saved ${dir} — ${count} sources; screenshot column: ${note}`);
    console.log(maps.plugin
      ? '  each map\'s "# source plugin" header says why; audit a DEVELOPMENT build'
      : '  set audit.screenshotCoveragePlugin in abtests.config.ts and audit a DEVELOPMENT build');
    return;
  }
  const { elements, unattached } = fillCells(dir, maps.byTest, letterOf);
  const total = totalOf(dir);
  console.log(`saved ${dir} — ${count} sources, ${elements} element lines: ${total.seen} seen, ${total.blind} at 0%`);
  if (unattached) {
    console.log(`  ${unattached} element line(s) sit under no covered statement — the source on disk may not be the source the server was built from`);
  }
}

// `.diff` folders live alongside the snapshots; they are results, not snapshots.
const snapshots = (): string[] => (fs.existsSync(DIR) ? fs.readdirSync(DIR, { withFileTypes: true }) : [])
  .filter((e) => e.isDirectory() && !e.name.endsWith('.diff')).map((e) => path.join(DIR, e.name)).sort();

function list(): void {
  const all = snapshots();
  if (!all.length) { console.log(`no snapshots yet — run \`save "<sources>"\``); return; }
  for (const dir of all) {
    const total = totalOf(dir);
    const seen = legendOf(dir).note ?? `${total.seen} seen, ${total.blind} at 0%`;
    console.log(`${dir}  ${sourceFiles(dir).length} files  ${seen}  |  ${total.covered}/${total.statements} statements`);
  }
}

// `diff -u` exits 1 when the files differ, with the hunks on stdout.
function unifiedDiff(before: string, after: string): string {
  try {
    execFileSync('diff', ['-u', '--label', before, '--label', after, before, after], { encoding: 'utf8' });
    return '';
  } catch (err) {
    // Only exit 1 means "the files differ". No `diff` on PATH or an unreadable file must not
    // read as "no changes".
    const { status, stdout } = err as { status?: number | null; stdout?: string | null };
    if (status !== 1) throw err;
    return stdout ?? '';
  }
}

function diff(older?: string, newer?: string): void {
  const all = snapshots();
  const [before, after] = [older || all.at(-2), newer || all.at(-1)];
  if (!before || !after || before === after) throw new Error('need two snapshots to compare');
  for (const dir of [before, after]) if (!fs.existsSync(dir)) throw new Error(`no such snapshot: ${dir}`);
  const [beforeLegend, afterLegend] = [legendOf(before), legendOf(after)];
  if (beforeLegend.sources !== afterLegend.sources) console.error('warning: saved with different sources — the diff is not comparable');

  const outDir = `${after}--vs--${path.basename(before)}.diff`;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const keys = (dir: string): string[] => sourceFiles(dir).map((f) => path.relative(dir, f));
  const [beforeKeys, afterKeys] = [new Set(keys(before)), new Set(keys(after))];
  const mark = (n: number): string => (n ? `${n > 0 ? '+' : ''}${n}`.padEnd(3) : '   ');
  let changed = 0;
  const rows = [...new Set([...beforeKeys, ...afterKeys])].sort().map((key) => {
    if (!beforeKeys.has(key) || !afterKeys.has(key)) return { move: Infinity, line: `${beforeKeys.has(key) ? 'REMOVED' : 'ADDED'} ${key}` };
    const [beforeFile, afterFile] = [path.join(before, key), path.join(after, key)];
    const body = unifiedDiff(beforeFile, afterFile);
    // One .diff per CHANGED source only, so `ls` on the folder names exactly what moved.
    if (body) {
      changed += 1;
      fs.mkdirSync(path.dirname(path.join(outDir, key)), { recursive: true });
      fs.writeFileSync(path.join(outDir, `${key}.diff`), body);
    }
    const [beforeTally, afterTally] = [tally(read(beforeFile)), tally(read(afterFile))];
    return {
      // Screenshot movement dominates the ordering; statements only break ties.
      move: Math.abs(afterTally.seen - beforeTally.seen) * 1000 + Math.abs(afterTally.covered - beforeTally.covered),
      line: `${String(beforeTally.seen).padStart(3)} ->${String(afterTally.seen).padStart(4)} ${mark(afterTally.seen - beforeTally.seen)} ${String(afterTally.blind).padStart(3)}  |`
        + ` ${String(beforeTally.covered).padStart(4)} ->${String(afterTally.covered).padStart(5)} of ${String(afterTally.statements).padEnd(4)} ${mark(afterTally.covered - beforeTally.covered)}`
        + `  ${body ? '' : '(no diff) '}${key}`,
    };
  });

  const [beforeTotal, afterTotal] = [totalOf(before), totalOf(after)];
  const out = [
    `# before: ${before}`, ...(beforeLegend.note ? [`#   screenshot column: ${beforeLegend.note}`] : []),
    `# after:  ${after}`, ...(afterLegend.note ? [`#   screenshot column: ${afterLegend.note}`] : []),
    '#',
    `# TOTAL  ${beforeTotal.seen} -> ${afterTotal.seen} seen  (${afterTotal.blind} at 0%)   |   ${beforeTotal.covered} -> ${afterTotal.covered} statements`,
    '#',
    '#  seen ->seen   d  0%   |   cov ->  cov of stmt  d   source',
    '#',
    ...rows.sort((row, other) => other.move - row.move).map((row) => row.line),
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.txt'), `${out}\n`);
  console.log(out);
  console.log(`\n${changed} of ${afterKeys.size} sources changed — per-source diffs in ${outDir}/`);
}

const [command = '', ...rest] = process.argv.slice(2);
const commands: Record<string, () => void> = { save: () => save(rest[0]), list, diff: () => diff(rest[0], rest[1]) };
if (!commands[command]) {
  console.log('usage: coverage-baseline.mts save "<sources>" | list | diff [<older> <newer>]');
  process.exit(1);
}
try {
  commands[command]();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
