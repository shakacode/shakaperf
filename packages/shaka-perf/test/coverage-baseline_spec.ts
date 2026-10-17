/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../../.claude/skills/shaka-perf-coverage/coverage-baseline.mts');

// Alpha renders list items; Beta's list is empty. So the `.map` callback on line 4 is a
// statement only Alpha ran, right above a footer that both tests rendered.
const SOURCE = [
  'export function List({ items }) {',
  '  return (',
  '    <ul>',
  '      {items.map((i) => <li key={i}>{i}</li>)}',
  '      <li className="footer">end</li>',
  '    </ul>',
  '  );',
  '}',
];
const FOOTER_ROW = 'li .footer => 0,0,10,10 100% visible @ web/List.tsx:5\n';

interface FixtureTest { id: string; name: string; file: string; ran: Record<number, number> }

describe('coverage-baseline.mts save', function () {
  const dirs: string[] = [];
  afterEach(function () {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function fixture(extra: FixtureTest[] = []): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-baseline-'));
    dirs.push(dir);
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), text);
    };
    write('web/List.tsx', `${SOURCE.join('\n')}\n`);
    write('web/ListItem.tsx', 'export const ListItem = () => null;\n');
    const tests: FixtureTest[] = [
      { id: 'alpha', name: 'Alpha', file: 'web/List.tsx', ran: { 0: 1, 1: 1 } },
      { id: 'beta', name: 'Beta', file: 'web/List.tsx', ran: { 0: 1, 1: 0 } },
      ...extra,
    ];
    write('audit-results/report.json', JSON.stringify({
      tests: tests.map(({ id, name }) => ({ id, name, outcomes: [{ kind: 'ok', stage: 'code_coverage' }] })),
    }));
    for (const { id, file, ran } of tests) {
      write(`audit-results/${id}/artifacts/coverage.json`, JSON.stringify({
        [path.join(dir, file)]: { statementMap: { 0: { start: { line: 2 } }, 1: { start: { line: 4 } } }, s: ran },
      }));
      write(`audit-results/${id}/artifacts/visibility-map.txt`, FOOTER_ROW);
    }
    return dir;
  }

  // Plain `node`, as the skill documents; Yarn's PnP loader in NODE_OPTIONS cannot load `.mts`.
  function save(dir: string): string {
    return execFileSync(process.execPath, [SCRIPT, 'save', 'List'], {
      cwd: dir, env: { ...process.env, NODE_OPTIONS: '', SOURCE_ROOT: 'web' }, encoding: 'utf8',
    });
  }

  function snapshots(dir: string): string[] {
    return fs.readdirSync(path.join(dir, 'audit-results', 'coverage-baselines'));
  }

  function footerLine(dir: string): string {
    const [snapshot] = snapshots(dir);
    return fs.readFileSync(path.join(dir, 'audit-results', 'coverage-baselines', snapshot, 'List.tsx'), 'utf8')
      .split('\n')[4];
  }

  it('reads sources from SOURCE_ROOT', function () {
    assert.match(save(fixture()), /^saved \S+ — 2 sources/);
  });

  it('credits an element to every test that rendered it', function () {
    const dir = fixture();
    save(dir);
    assert.match(footerLine(dir), /\| A=100%,B=100%$/);
  });

  it('keeps the cells when a rendering test has no coverage in that file', function () {
    // Gamma shows the footer but only its sibling file reached Gamma's coverage.
    const dir = fixture([{ id: 'gamma', name: 'Gamma', file: 'web/ListItem.tsx', ran: { 0: 1 } }]);
    save(dir);
    assert.match(footerLine(dir), /\| A=100%,B=100%$/);
  });

  it('counts each element line once', function () {
    assert.match(save(fixture()), /1 element lines: 1 seen, 0 at 0%/);
  });

  it('never overwrites an earlier snapshot', function () {
    const dir = fixture();
    save(dir);
    save(dir);
    assert.strictEqual(snapshots(dir).length, 2);
  });
});
