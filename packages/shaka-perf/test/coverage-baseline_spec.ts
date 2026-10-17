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

describe('coverage-baseline.mts save', function () {
  function fixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-baseline-'));
    const source = path.join(dir, 'web', 'List.tsx');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, `${SOURCE.join('\n')}\n`);
    const tests = [
      { id: 'alpha', name: 'Alpha', ran: { 0: 1, 1: 1 } },
      { id: 'beta', name: 'Beta', ran: { 0: 1, 1: 0 } },
    ];
    fs.mkdirSync(path.join(dir, 'audit-results'));
    fs.writeFileSync(path.join(dir, 'audit-results', 'report.json'), JSON.stringify({
      tests: tests.map(({ id, name }) => ({ id, name, outcomes: [{ kind: 'ok', stage: 'code_coverage' }] })),
    }));
    for (const { id, ran } of tests) {
      const artifacts = path.join(dir, 'audit-results', id, 'artifacts');
      fs.mkdirSync(artifacts, { recursive: true });
      fs.writeFileSync(path.join(artifacts, 'coverage.json'), JSON.stringify({
        [source]: { statementMap: { 0: { start: { line: 2 } }, 1: { start: { line: 4 } } }, s: ran },
      }));
      fs.writeFileSync(path.join(artifacts, 'visibility-map.txt'),
        'li .footer => 0,0,10,10 100% visible @ web/List.tsx:5\n');
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

  it('reads sources from SOURCE_ROOT', function () {
    assert.match(save(fixture()), /^saved \S+ — 1 sources/);
  });

  it('credits an element to every test that rendered it', function () {
    const dir = fixture();
    save(dir);
    const [snapshot] = snapshots(dir);
    const footer = fs.readFileSync(path.join(dir, 'audit-results', 'coverage-baselines', snapshot, 'List.tsx'), 'utf8')
      .split('\n')[4];
    assert.match(footer, /\| A=100%,B=100%$/);
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
