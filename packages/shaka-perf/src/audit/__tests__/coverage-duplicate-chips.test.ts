/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';
import type { ChipStageResult } from '../../pipeline/pipeline';
import {
  coverageCoversChips,
  coverageDuplicateChips,
  coverageSignaturesByTest,
} from '../coverage-duplicate-chips';
import type { AuditResult } from '../stages/audit';

// Real AbTestDefinitions carry callbacks and registry plumbing we don't
// need here — only `name` is read by the chip logic. Cast keeps the test
// shape readable without dragging in the full registry.
function mkTest(name: string): AbTestDefinition {
  return { name } as AbTestDefinition;
}

function mkAuditEntry(
  coverageStatementIdsHref?: string,
): ChipStageResult<AuditResult> {
  return {
    stage: 'audit',
    viewport: {
      label: 'desktop',
      width: 1280,
      height: 800,
      formFactor: 'desktop',
      deviceScaleFactor: 1,
    },
    measurement: {
      metrics: [],
      ...(coverageStatementIdsHref ? { coverageStatementIdsHref } : {}),
    },
    outcome: { kind: 'ok' } as ChipStageResult<AuditResult>['outcome'],
  };
}

describe('coverageSignaturesByTest', () => {
  const artifacts = new Map<string, unknown>();
  const readJsonArtifact = <T>(href: string): T | undefined =>
    artifacts.get(href) as T | undefined;

  beforeEach(() => artifacts.clear());

  function writeIds(name: string, ids: readonly string[]): string {
    const href = `${name}.json`;
    artifacts.set(href, ids);
    return href;
  }

  it('unions statement ids across all viewports of a test', () => {
    const test = mkTest('a');
    const signatures = coverageSignaturesByTest([{
      test,
      auditResults: [
        mkAuditEntry(writeIds('desktop', ['f.js:1', 'f.js:2'])),
        mkAuditEntry(writeIds('mobile', ['f.js:2', 'g.js:5'])),
      ],
    }], readJsonArtifact);
    expect([...signatures.get(test)!].sort()).toEqual(['f.js:1', 'f.js:2', 'g.js:5']);
  });

  it('omits tests with no coverage signal', () => {
    const a = mkTest('a');
    const b = mkTest('b');
    const signatures = coverageSignaturesByTest([
      { test: a, auditResults: [mkAuditEntry(writeIds('a', ['x:1']))] },
      { test: b, auditResults: [mkAuditEntry()] },
    ], readJsonArtifact);
    expect(signatures.has(a)).toBe(true);
    expect(signatures.has(b)).toBe(false);
  });
});

describe('coverageDuplicateChips', () => {
  it('emits "fully covered by" on strict-subset tests', () => {
    const small = mkTest('small');
    const big = mkTest('big');
    const chips = coverageDuplicateChips(new Map([
      [small, new Set(['x:1', 'x:2'])],
      [big, new Set(['x:1', 'x:2', 'x:3'])],
    ]));
    expect(chips.get(small)).toMatchObject({
      tag: 'duplicate',
      text: 'fully covered by big',
      affectsCardOrder: false,
    });
    expect(chips.has(big)).toBe(false);
  });

  it('emits "duplicate of" on both members of an equal-signature pair', () => {
    const a = mkTest('a');
    const b = mkTest('b');
    const sigs = new Map([
      [a, new Set(['x:1', 'x:2'])],
      [b, new Set(['x:1', 'x:2'])],
    ]);
    const chips = coverageDuplicateChips(sigs);
    expect(chips.get(a)?.text).toBe('duplicate of b');
    expect(chips.get(b)?.text).toBe('duplicate of a');
  });

  it('points each member of an equivalence triplet at the lex-first other', () => {
    const a = mkTest('a');
    const b = mkTest('b');
    const c = mkTest('c');
    const sig = new Set(['x:1']);
    const chips = coverageDuplicateChips(new Map([[a, sig], [b, sig], [c, sig]]));
    expect(chips.get(a)?.text).toBe('duplicate of b');
    expect(chips.get(b)?.text).toBe('duplicate of a');
    expect(chips.get(c)?.text).toBe('duplicate of a');
  });

  it('picks the smallest superset, then lex-asc name', () => {
    const a = mkTest('a');
    const tightCover = mkTest('z-tight'); // smallest superset
    const wideCover = mkTest('m-wide');   // larger superset, lex-earlier
    const chips = coverageDuplicateChips(new Map([
      [a, new Set(['x:1', 'x:2'])],
      [tightCover, new Set(['x:1', 'x:2', 'x:3'])],
      [wideCover, new Set(['x:1', 'x:2', 'x:3', 'x:4'])],
    ]));
    expect(chips.get(a)?.text).toBe('fully covered by z-tight');
  });

  it('breaks ties between equal-size supersets by name', () => {
    const a = mkTest('a');
    const z = mkTest('z');
    const m = mkTest('m');
    const chips = coverageDuplicateChips(new Map([
      [a, new Set(['x:1'])],
      [z, new Set(['x:1', 'x:2'])],
      [m, new Set(['x:1', 'x:2'])],
    ]));
    expect(chips.get(a)?.text).toBe('fully covered by m');
  });

  it('emits nothing for tests with unique coverage', () => {
    const a = mkTest('a');
    const b = mkTest('b');
    const chips = coverageDuplicateChips(new Map([
      [a, new Set(['x:1', 'x:2'])],
      [b, new Set(['x:1', 'x:3'])],
    ]));
    expect(chips.size).toBe(0);
  });

  it('ignores tests absent from the signatures map', () => {
    const a = mkTest('a');
    const chips = coverageDuplicateChips(new Map([[a, new Set(['x:1'])]]));
    expect(chips.size).toBe(0);
  });
});

describe('coverageCoversChips', () => {
  it('emits "fully covers <name>" mirroring the covered side', () => {
    const small = mkTest('small');
    const big = mkTest('big');
    const chips = coverageCoversChips(new Map([
      [small, new Set(['x:1', 'x:2'])],
      [big, new Set(['x:1', 'x:2', 'x:3'])],
    ]));
    expect(chips.get(big)).toMatchObject({
      tag: 'duplicate',
      text: 'fully covers small',
      affectsCardOrder: false,
    });
    expect(chips.has(small)).toBe(false);
  });

  it('lists multiple covered tests in the chip text alphabetically', () => {
    const a = mkTest('a');
    const c = mkTest('c');
    const b = mkTest('b');
    const big = mkTest('big');
    const chips = coverageCoversChips(new Map([
      [a, new Set(['x:1'])],
      [b, new Set(['x:2'])],
      [c, new Set(['x:3'])],
      [big, new Set(['x:1', 'x:2', 'x:3'])],
    ]));
    expect(chips.get(big)?.text).toBe('fully covers a, b, c');
  });

  it('does not emit on exact-equal pairs (handled by "duplicate of" chip)', () => {
    const a = mkTest('a');
    const b = mkTest('b');
    const sig = new Set(['x:1', 'x:2']);
    const chips = coverageCoversChips(new Map([[a, sig], [b, sig]]));
    expect(chips.size).toBe(0);
  });

  it('emits on the broader test in a 3-way A ⊊ B == C scenario', () => {
    // A is covered by B and C (both supersets, equal to each other).
    // B and C don't strictly cover each other (sizes equal) → no chip on them
    // from the equal pair, but B and C DO strictly cover A → both get
    // "fully covers a".
    const a = mkTest('a');
    const b = mkTest('b');
    const c = mkTest('c');
    const chips = coverageCoversChips(new Map([
      [a, new Set(['x:1'])],
      [b, new Set(['x:1', 'x:2'])],
      [c, new Set(['x:1', 'x:2'])],
    ]));
    expect(chips.get(b)?.text).toBe('fully covers a');
    expect(chips.get(c)?.text).toBe('fully covers a');
    expect(chips.has(a)).toBe(false);
  });

  it('emits nothing when no test strictly covers another', () => {
    const a = mkTest('a');
    const b = mkTest('b');
    const chips = coverageCoversChips(new Map([
      [a, new Set(['x:1', 'x:2'])],
      [b, new Set(['x:1', 'x:3'])],
    ]));
    expect(chips.size).toBe(0);
  });
});
