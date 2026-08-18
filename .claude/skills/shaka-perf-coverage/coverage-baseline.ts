#!/usr/bin/env node
// Snapshots view-coverage output, and diffs the CURRENT coverage against a snapshot.
//
//   node coverage-baseline.ts save "HorizonNav/.*\.tsx,NextMenuGroup.*\.jsx"
//   node coverage-baseline.ts list
//   node coverage-baseline.ts diff "HorizonNav/.*\.tsx"             # vs the newest snapshot
//   node coverage-baseline.ts diff "HorizonNav/.*\.tsx" coverage-baselines/2026-08-18-05-36-12.txt
//
// save never overwrites: each run adds a timestamped file under coverage-baselines/.
// diff regenerates coverage from the latest audit run via view-coverage.js and compares it
// to the snapshot, so it always answers "what changed since then".

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = 'coverage-baselines';
const VIEW = path.join(__dirname, 'view-coverage.js');
const HEADER = '# sources: ';

const snapshots = (): string[] => (fs.existsSync(DIR) ? fs.readdirSync(DIR) : [])
  .filter((name: string) => name.endsWith('.txt'))
  .sort()
  .map((name: string) => path.join(DIR, name));

const capture = (sources: string): string => `${HEADER}${sources}\n${
  execFileSync('node', [VIEW, sources], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })}`;

const sourcesOf = (file: string): string => {
  const first = fs.readFileSync(file, 'utf8').split('\n')[0];
  if (!first.startsWith(HEADER)) throw new Error(`${file} has no "${HEADER}" header — not a snapshot`);
  return first.slice(HEADER.length);
};

function save(sources: string): void {
  if (!sources) throw new Error('save needs a source regex list, e.g. save "HorizonNav/.*\\.tsx"');
  fs.mkdirSync(DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = path.join(DIR, `${stamp}.txt`);
  fs.writeFileSync(file, capture(sources));
  console.log(`saved ${file}`);
}

function list(): void {
  const all = snapshots();
  if (!all.length) {
    console.log(`no snapshots yet — run \`save "<sources>"\``);
    return;
  }
  for (const file of all) console.log(`${file}  ${sourcesOf(file)}`);
}

function diff(sources: string, baseline?: string): void {
  if (!sources) throw new Error('diff needs a source regex list, e.g. diff "HorizonNav/.*\\.tsx"');
  const file = baseline || snapshots().at(-1);
  if (!file) throw new Error(`no snapshot to compare against — run \`save "<sources>"\` first`);
  if (!fs.existsSync(file)) throw new Error(`no such snapshot: ${file}`);

  // Comparing against a snapshot of a different file set produces a meaningless diff.
  const recorded = sourcesOf(file);
  if (recorded !== sources) console.error(`warning: ${file} was saved with "${recorded}"`);

  const current = path.join(os.tmpdir(), 'coverage-current.txt');
  fs.writeFileSync(current, capture(sources));
  try {
    // diff exits 1 when files differ, which execFileSync treats as a throw.
    execFileSync('diff', ['-u', '--label', file, '--label', 'current', file, current], { stdio: 'inherit' });
    console.log(`no change since ${file}`);
  } catch {
    // The diff already went to stdout via stdio: inherit.
  }
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, () => void> = {
  diff: () => diff(rest[0], rest[1]),
  list,
  save: () => save(rest[0]),
};

if (!commands[command]) {
  console.log('usage: coverage-baseline.ts save "<sources>" | list | diff "<sources>" [snapshot-file]');
  process.exit(1);
}

try {
  commands[command]();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
