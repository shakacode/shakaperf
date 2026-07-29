/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';
import type { ChipStageResults } from '../pipeline/pipeline';
import type { ChipDescriptor } from '../pipeline/report';
import type { AuditResult } from './stages/audit';

/**
 * Union of every viewport's coverage statement-id artifact for each test.
 * A test contributes a signature only if at least one of its audit measurements
 * had a non-empty coverage list — tests missing coverage (uninstrumented
 * bundles, drain failures) are absent from the returned map and therefore
 * never get the "duplicated" chip.
 */
export function coverageSignaturesByTest(
  perTest: readonly { test: AbTestDefinition; auditResults: ChipStageResults<AuditResult> }[],
  readJsonArtifact?: <T>(artifactPath: string) => T | undefined,
): Map<AbTestDefinition, ReadonlySet<string>> {
  const out = new Map<AbTestDefinition, ReadonlySet<string>>();
  for (const { test, auditResults } of perTest) {
    const ids = new Set<string>();
    for (const entry of auditResults) {
      for (const id of readCoverageStatementIds(
        entry.measurement.coverageStatementIdsHref,
        readJsonArtifact,
      )) {
        ids.add(id);
      }
    }
    if (ids.size > 0) out.set(test, ids);
  }
  return out;
}

function readCoverageStatementIds(
  href: string | undefined,
  readJsonArtifact:
    (<T>(artifactPath: string) => T | undefined) | undefined,
): readonly string[] {
  if (!href || !readJsonArtifact) return [];
  const value = readJsonArtifact<unknown>(href);
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : [];
}

/**
 * Emits one chip per test whose JS coverage is fully contained in another
 * test's. "Fully contained" is strict set inclusion on `${file}:${stmtId}`
 * keys: every statement A executed was also executed by B.
 *
 * Selection when multiple tests cover A: pick the smallest superset (closest
 * duplicate), tiebreak by name lex-asc. For exact-equality classes (A == B),
 * every member gets the chip pointing at the lex-first *other* member, so
 * a duplicate triplet surfaces three pills, not a single arbitrary one.
 *
 * Wording: `duplicate of <B>` when sigs match exactly, `fully covered by <B>`
 * when A ⊊ B. Same `tag: 'duplicate'` so they group under one filter button.
 */
export function coverageDuplicateChips(
  signatures: ReadonlyMap<AbTestDefinition, ReadonlySet<string>>,
): Map<AbTestDefinition, ChipDescriptor> {
  const out = new Map<AbTestDefinition, ChipDescriptor>();
  const tests = [...signatures.keys()];
  for (const a of tests) {
    const sigA = signatures.get(a)!;
    let best: { test: AbTestDefinition; size: number; equal: boolean } | undefined;
    for (const b of tests) {
      if (b === a) continue;
      const sigB = signatures.get(b)!;
      // A ⊆ B forces |A| ≤ |B|; skip the inner loop when sizes already rule
      // it out. Keeps the pass O(N · average-signature-size) in the common
      // case where most tests aren't subsets of each other.
      if (sigB.size < sigA.size) continue;
      let isSubset = true;
      for (const id of sigA) {
        if (!sigB.has(id)) {
          isSubset = false;
          break;
        }
      }
      if (!isSubset) continue;
      const candidate = {
        test: b,
        size: sigB.size,
        equal: sigB.size === sigA.size,
      };
      if (isBetterCover(candidate, best)) best = candidate;
    }
    if (!best) continue;
    out.set(a, best.equal ? exactDuplicateChip(best.test) : strictlyCoveredChip(best.test));
  }
  return out;
}

function isBetterCover(
  candidate: { test: AbTestDefinition; size: number },
  current: { test: AbTestDefinition; size: number } | undefined,
): boolean {
  if (!current) return true;
  if (candidate.size !== current.size) return candidate.size < current.size;
  return candidate.test.name.localeCompare(current.test.name) < 0;
}

function exactDuplicateChip(other: AbTestDefinition): ChipDescriptor {
  return {
    tag: 'duplicate',
    text: `duplicate of ${other.name}`,
    color: 'gray',
    sortingWeight: 47,
    affectsCardOrder: false,
    tooltip: `Executed exactly the same set of instrumented JS statements as ${other.name} — this test adds no extra coverage.`,
  };
}

function strictlyCoveredChip(other: AbTestDefinition): ChipDescriptor {
  return {
    tag: 'duplicate',
    text: `fully covered by ${other.name}`,
    color: 'gray',
    sortingWeight: 47,
    affectsCardOrder: false,
    tooltip: `Every instrumented JS statement this test executed was also executed by ${other.name}.`,
  };
}

/**
 * Mirror of `coverageDuplicateChips` looking the other way: emits a chip on
 * every test that strictly covers ≥1 other test's coverage. Lets a reviewer
 * spot the "kitchen sink" tests — the ones worth keeping when pruning
 * duplicates. Exact-equal pairs are *not* counted: both members already
 * carry `duplicate of <other>`, neither has a one-sided claim to "cover" the
 * other.
 *
 * Shares `tag: 'duplicate'` with the covered-side chips so all duplication
 * relationships group under a single "duplicate · N" filter button.
 */
export function coverageCoversChips(
  signatures: ReadonlyMap<AbTestDefinition, ReadonlySet<string>>,
): Map<AbTestDefinition, ChipDescriptor> {
  const out = new Map<AbTestDefinition, ChipDescriptor>();
  const tests = [...signatures.keys()];
  for (const b of tests) {
    const sigB = signatures.get(b)!;
    const covered: AbTestDefinition[] = [];
    for (const a of tests) {
      if (a === b) continue;
      const sigA = signatures.get(a)!;
      // Strict superset: |B| > |A| AND A ⊆ B. Skipping when |B| ≤ |A| also
      // excludes the exact-equal case (handled by the "duplicate of" chip).
      if (sigB.size <= sigA.size) continue;
      let isSubset = true;
      for (const id of sigA) {
        if (!sigB.has(id)) {
          isSubset = false;
          break;
        }
      }
      if (isSubset) covered.push(a);
    }
    if (covered.length === 0) continue;
    out.set(b, coversChip(covered));
  }
  return out;
}

function coversChip(covered: readonly AbTestDefinition[]): ChipDescriptor {
  // Mirror the covered side's wording: each test it covers reads `fully
  // covered by <this.name>`, so this side reads `fully covers <them>` with
  // the matching names in the chip text (not buried in a tooltip).
  const names = [...covered].map((t) => t.name).sort((a, b) => a.localeCompare(b));
  return {
    tag: 'duplicate',
    text: `fully covers ${names.join(', ')}`,
    color: 'gray',
    sortingWeight: 48,
    affectsCardOrder: false,
    tooltip:
      `Executed every instrumented JS statement ${covered.length === 1 ? 'that test' : 'those tests'} executed, plus more.`,
  };
}
