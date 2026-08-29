#!/usr/bin/env node
// The one command you run. A snapshot is a directory under `coverage-baselines/`.
//
//   save "<sources>"        write a scaffold from the latest audit run
//   fill [<dir>]            fill its screenshot field from <dir>/anchors.json
//   list                    which snapshots exist, and which are still unfinished
//   diff [<older> <newer>]  compare two, newest pair by default
//
// The loop: save + anchor + fill the BEFORE, make your change, re-audit, save + fill the
// AFTER, diff. `save` carries the previous snapshot's anchors.json forward, so anchoring is
// paid for once.
//
// AUDIT_ROOT points `save` and `fill` at a run stashed elsewhere, which is how you snapshot
// a control side after its `audit-results/` has been overwritten.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { build, tally } = require('./snapshot');
const { fill } = require('./fill-visibility');

const DIR = 'coverage-baselines';
const HEADER = '# sources: ';
const results = (): string => process.env.AUDIT_ROOT || 'audit-results';

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

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name !== 'legend.txt' && e.name !== 'anchors.json') out.push(full);
    }
  };
  walk(dir);
  return out;
};

const totalOf = (dir: string) => sourceFiles(dir)
  .map((f: string) => tally(fs.readFileSync(f, 'utf8')))
  .reduce((a: any, b: any) => ({
    seen: a.seen + b.seen, blind: a.blind + b.blind, unknown: a.unknown + b.unknown,
    statements: a.statements + b.statements, covered: a.covered + b.covered,
  }), { seen: 0, blind: 0, unknown: 0, statements: 0, covered: 0 });

function save(sources: string): void {
  if (!sources) throw new Error('save needs a source regex list, e.g. save "HorizonNav/.*\\.tsx"');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dir = path.join(DIR, stamp);
  const count = build(sources.split(',').map((s: string) => s.trim()).filter(Boolean), results(), dir);
  console.log(`saved ${dir} — ${count} sources`);

  // Anchoring is the expensive, judgement-carrying half; percentages are re-derivable. Carry
  // it forward so a re-run is a re-grep, not a re-think.
  const previous = snapshots().filter((d: string) => d !== dir).at(-1);
  const from = previous && path.join(previous, 'anchors.json');
  if (from && fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(dir, 'anchors.json'));
    console.log(`carried anchors.json forward from ${previous} — now run \`fill ${dir}\``);
  } else {
    console.log(`write ${dir}/anchors.json, then \`fill ${dir}\` — the screenshot field is empty until then`);
  }
}

function fillCmd(dir?: string): void {
  const target = dir || snapshots().at(-1);
  if (!target) throw new Error('no snapshot to fill');
  const r = fill(target, results());
  console.log(`${target}: wrote ${r.written} cells`);
  if (r.unattached) console.log(`  ${r.unattached} anchor(s) had no covered statement within 60 lines above — check the line number`);
  if (r.missing.length) console.log(`  not in this snapshot: ${r.missing.join(', ')}`);
  if (r.unresolved.length) {
    console.log(`  ${r.unresolved.length} anchor(s) matched nothing in this run — left as "?", verify them:`);
    for (const a of r.unresolved) console.log(`    ${a}`);
  }
}

function list(): void {
  const all = snapshots();
  if (!all.length) { console.log(`no snapshots yet — run \`save "<sources>"\``); return; }
  for (const dir of all) {
    const t = totalOf(dir);
    const missing = fs.existsSync(path.join(dir, 'anchors.json')) ? '' : ', no anchors.json';
    const state = t.seen + t.blind + t.unknown
      ? `${t.seen} seen, ${t.blind} at 0%, ${t.unknown} unproven`
      : `NOT FILLED${missing}`;
    console.log(`${dir}  ${sourceFiles(dir).length} files  ${state}`);
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
  for (const dir of [before, after]) {
    if (!totalOf(dir).seen) console.error(`warning: ${dir} has no screenshot data — this diff sees code coverage only`);
  }

  const outDir = `${after}--vs--${path.basename(before)}.diff`;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const rel = (dir: string, f: string) => path.relative(dir, f);
  const beforeFiles = new Map(sourceFiles(before).map((f: string) => [rel(before, f), f]));
  const afterFiles = new Map(sourceFiles(after).map((f: string) => [rel(after, f), f]));

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
        + ` ${String(y.blind).padStart(3)} ${String(y.unknown).padStart(3)}  |`
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
    `# TOTAL  ${x.seen} -> ${y.seen} seen  (${y.blind} at 0%, ${y.unknown} unproven)`
      + `   |   ${x.covered} -> ${y.covered} statements`,
    '#',
    '#  seen ->seen   d  0%   ?      |   cov ->  cov of stmt  d   source',
    '#',
    ...rows.sort((p, q) => q.move - p.move).map(r => r.line),
  ].join('\n');

  fs.writeFileSync(path.join(outDir, 'summary.txt'), `${out}\n`);
  console.log(out);
  console.log(`\n${changed} of ${afterFiles.size} sources changed — per-source diffs in ${outDir}/`);
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, () => void> = {
  diff: () => diff(rest[0], rest[1]),
  fill: () => fillCmd(rest[0]),
  list,
  save: () => save(rest[0]),
};

if (!commands[command]) {
  console.log('usage: coverage-baseline.ts save "<sources>" | fill [<dir>] | list | diff [<older> <newer>]');
  process.exit(1);
}

try {
  commands[command]();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
