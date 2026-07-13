/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useCallback, useMemo, useState } from 'react';
import type {
  BisectCategory,
  ChipDescriptor,
  ReportData,
  ReportMeta,
  ReportOutcome,
  SortDescriptor,
  TestResult,
} from './types';
import {
  selectionCategories,
  stageNamesForCategories,
  selectionTestIds,
  type BisectSelection,
} from './bisect-selection';
import { Header } from './components/Header';
import { BisectNavigator } from './components/BisectNavigator';
import { BisectSelectionSummary } from './components/BisectSelectionSummary';
import { SearchBar } from './components/SearchBar';
import { ChipFilter, type ChipFilterOption } from './components/ChipFilter';
import { SortChips, type SortChipOption, type SortDirection } from './components/SortChips';
import { TestCard } from './components/TestCard';
import { ErrorBanner } from './components/ErrorBanner';
import { MissingArtifactsCard } from './components/MissingArtifactsCard';
import { SkippedChips } from './components/SkippedChips';
import { pipelineStagesForReport, type ReportStage } from '../../src/pipeline/pipeline-artifacts';
import {
  AccessibilityGlobalFilter,
  AccessibilityReportFilterProvider,
  collectConfiguredFilterOptions,
  defaultAccessibilityFilterSelection,
  hasAccessibilityFilterOptions,
  normalizeAccessibilityFilterSelection,
  type AccessibilityFilterSelection,
  type AccessibilityFilterState,
} from '../../src/audit/stages/accessibility/report';
import type { AccessibilityResult } from '../../src/audit/stages/accessibility/types';
import {
  StageFilter,
  type StageFilterOption,
  type StageFilterSelectionUpdate,
} from './components/StageFilter';

const ALL_FILTER_KEY = '__all__';

const ALL_FILTER_CHIP: ChipDescriptor = {
  tag: 'all',
  text: 'all',
  color: 'blue',
  sortingWeight: -Infinity,
  tooltip: 'include cards without any chips',
};

function chipKey(chip: ChipDescriptor): string {
  return chip.tag;
}

function compareChips(a: ChipDescriptor, b: ChipDescriptor): number {
  return a.sortingWeight - b.sortingWeight ||
    a.tag.localeCompare(b.tag) ||
    a.text.localeCompare(b.text) ||
    a.color.localeCompare(b.color);
}

function buildChipFilters(tests: readonly TestResult[]): ChipFilterOption[] {
  const filters = new Map<string, ChipFilterOption>();
  for (const test of tests) {
    const seenTags = new Set<string>();
    for (const chip of test.chips) {
      const key = chipKey(chip);
      if (seenTags.has(key)) continue;
      seenTags.add(key);
      const existing = filters.get(key);
      if (existing) {
        existing.count++;
        const tagHiddenByDefault = existing.chip.tagHiddenByDefault || chip.tagHiddenByDefault;
        const selected = compareChips(chip, existing.chip) < 0 ? chip : existing.chip;
        existing.chip = { ...selected, tagHiddenByDefault: tagHiddenByDefault || undefined };
        continue;
      }
      filters.set(key, { key, chip, count: 1 });
    }
  }
  const sorted = Array.from(filters.values()).sort((a, b) => compareChips(a.chip, b.chip));
  return [
    { key: ALL_FILTER_KEY, chip: ALL_FILTER_CHIP, count: tests.length },
    ...sorted,
  ];
}

/**
 * Maps each chip tag (plus the synthetic `__all__` key) to the set of test
 * ids that carry it. The filter logic is driven by which test ids are
 * visible — chip "selected" state is derived from that — so every filter
 * interaction reduces to "toggle these test ids in the visible set".
 */
function buildChipTestSets(tests: readonly TestResult[]): Map<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>();
  const allIds = new Set<string>();
  for (const t of tests) {
    allIds.add(t.id);
    for (const chip of t.chips) {
      let ids = map.get(chip.tag);
      if (!ids) {
        ids = new Set();
        map.set(chip.tag, ids);
      }
      ids.add(t.id);
    }
  }
  map.set(ALL_FILTER_KEY, allIds);
  return map;
}

function primaryChip(test: TestResult): ChipDescriptor | null {
  const ordering = test.chips.filter((chip) => chip.affectsCardOrder !== false);
  return [...ordering].sort(compareChips)[0] ?? null;
}

// Distinct sort dimensions across all tests → the "Sort by" chips, in the
// order the pipeline emitted them.
function buildSortOptions(tests: readonly TestResult[]): SortChipOption[] {
  const map = new Map<string, SortChipOption>();
  for (const test of tests) {
    for (const sort of test.sorts ?? []) {
      if (!map.has(sort.tag)) {
        map.set(sort.tag, { tag: sort.tag, label: sort.label, color: sort.color });
      }
    }
  }
  return [...map.values()];
}

// test id → (sort tag → descriptor), for O(1) per-card value lookup while sorting.
function buildSortValues(tests: readonly TestResult[]): Map<string, Map<string, SortDescriptor>> {
  const map = new Map<string, Map<string, SortDescriptor>>();
  for (const test of tests) {
    const inner = new Map<string, SortDescriptor>();
    for (const sort of test.sorts ?? []) inner.set(sort.tag, sort);
    map.set(test.id, inner);
  }
  return map;
}

// Order two tests by the active sort dimension. Cards lacking the dimension
// sink to the end regardless of direction. Worst-first honours each
// descriptor's `higherIsWorse`; `best` flips it.
function compareBySort(
  a: TestResult,
  b: TestResult,
  sort: { tag: string; dir: SortDirection },
  values: Map<string, Map<string, SortDescriptor>>,
): number {
  const da = values.get(a.id)?.get(sort.tag);
  const db = values.get(b.id)?.get(sort.tag);
  if (!da && !db) return a.name.localeCompare(b.name);
  if (!da) return 1;
  if (!db) return -1;
  const higherIsWorse = da.higherIsWorse ?? db.higherIsWorse ?? false;
  let cmp = higherIsWorse ? db.value - da.value : da.value - db.value;
  if (sort.dir === 'best') cmp = -cmp;
  return cmp || a.name.localeCompare(b.name);
}

function matchesQuery(test: TestResult, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    test.name.toLowerCase().includes(needle) ||
    test.filePath.toLowerCase().includes(needle) ||
    test.controlUrl.toLowerCase().includes(needle) ||
    test.experimentUrl.toLowerCase().includes(needle)
  );
}

function runKey(test: TestResult): string | null {
  return test.runId ?? null;
}

function newestRunKey(tests: readonly TestResult[]): string | null {
  let latest: string | null = null;
  for (const test of tests) {
    const key = runKey(test);
    if (key && (!latest || key > latest)) latest = key;
  }
  return latest;
}

function accessibilityResultsForTests(tests: readonly TestResult[]): AccessibilityResult[] {
  const results: AccessibilityResult[] = [];
  for (const test of tests) {
    for (const outcome of test.outcomes) {
      if (outcome.kind !== 'ok' || outcome.stage !== 'accessibility') continue;
      if (isAccessibilityResult(outcome.measurement)) results.push(outcome.measurement);
    }
  }
  return results;
}

function isAccessibilityResult(value: unknown): value is AccessibilityResult {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<AccessibilityResult>;
  return Array.isArray(candidate.scans) &&
    typeof candidate.totalViolations === 'number' &&
    candidate.effectiveConfig != null;
}

const HIDDEN_STAGE_FILTERS = new Set(['perf-warmup']);

// The stages this report can show, in pipeline order, each carrying its own
// chip label. Sourced from the reconstructed pipeline — a pipeline that can't
// be reconstructed throws rather than silently degrading the report.
function reportStages(meta: ReportMeta): ReportStage[] {
  return pipelineStagesForReport(meta.pipelineName, meta.pipelineConfig)
    .filter((stage) => !HIDDEN_STAGE_FILTERS.has(stage.name));
}

function outcomeRendersSection(outcome: ReportOutcome): boolean {
  return outcome.kind === 'error' ||
    (outcome.kind === 'ok' && outcome.measurement != null);
}

function hasReportableOutcomes(test: TestResult, includePersistedOutcomes: boolean): boolean {
  return test.measuredAt != null || (
    includePersistedOutcomes && test.outcomes.some(outcomeRendersSection)
  );
}

export function buildStageFilterOptions(meta: ReportMeta, tests: readonly TestResult[]): StageFilterOption[] {
  const counts = new Map<string, number>();
  for (const test of tests) {
    const seen = new Set<string>();
    for (const outcome of test.outcomes) {
      if (!outcomeRendersSection(outcome) || seen.has(outcome.stage)) continue;
      seen.add(outcome.stage);
      counts.set(outcome.stage, (counts.get(outcome.stage) ?? 0) + 1);
    }
  }
  // `label` rides along on each stage, so it's a guaranteed `string` here — no
  // name→label lookup that could miss. Stable sort keeps pipeline order within
  // the enabled/disabled groups.
  return reportStages(meta)
    .map((stage) => {
      const count = counts.get(stage.name) ?? 0;
      return {
        stage: stage.name,
        label: stage.label,
        count,
        disabled: count === 0,
      };
    })
    .sort((a, b) => Number(a.disabled) - Number(b.disabled));
}

function enabledStageNames(options: readonly StageFilterOption[]): Set<string> {
  return new Set(options.filter((option) => !option.disabled).map((option) => option.stage));
}

function normalizeStageSelection(
  selected: ReadonlySet<string> | null,
  options: readonly StageFilterOption[],
): Set<string> {
  const valid = enabledStageNames(options);
  if (selected == null) return valid;
  return new Set([...selected].filter((stage) => valid.has(stage)));
}

export function App({
  data,
  initialBisectSelection,
}: {
  data: ReportData;
  initialBisectSelection?: BisectSelection;
}) {
  const [query, setQuery] = useState('');
  const [bisectSelection, setBisectSelection] = useState<BisectSelection>(
    initialBisectSelection ?? { kind: 'all' },
  );
  // Visible-test-id set drives everything; null means "no override → use the
  // default of all measured tests". A chip's "selected" display state is
  // derived: it's active iff every test that carries the chip is visible.
  // That keeps the equivalence-class behaviour (coextensive chips toggle
  // together) and the "if a chip's tests are covered, auto-select it"
  // behaviour automatic — both fall out of the same predicate.
  const [visibleOverride, setVisibleOverride] = useState<Set<string> | null>(null);
  const [accessibilityFilterOverride, setAccessibilityFilterOverride] =
    useState<AccessibilityFilterSelection | null>(null);
  const [visibleStageOverride, setVisibleStageOverride] = useState<Set<string> | null>(null);
  // Active sort dimension + direction. null → default (chip/run-recency) order.
  const [sort, setSort] = useState<{ tag: string; dir: SortDirection } | null>(null);
  const isBisectReport = data.bisect != null;
  const cardTests = useMemo(
    () => data.tests.filter((test) => hasReportableOutcomes(test, isBisectReport)),
    [data.tests, isBisectReport],
  );
  const chipFilters = useMemo(() => buildChipFilters(cardTests), [cardTests]);
  const chipTestSets = useMemo(() => buildChipTestSets(cardTests), [cardTests]);
  const accessibilityResults = useMemo(() => accessibilityResultsForTests(cardTests), [cardTests]);
  const accessibilityFilterOptions = useMemo(
    () => collectConfiguredFilterOptions(accessibilityResults),
    [accessibilityResults],
  );
  const accessibilityFilterSelection = useMemo(() => {
    const fallback = defaultAccessibilityFilterSelection(accessibilityFilterOptions);
    return normalizeAccessibilityFilterSelection(
      accessibilityFilterOverride ?? fallback,
      accessibilityFilterOptions,
    );
  }, [accessibilityFilterOptions, accessibilityFilterOverride]);
  const setAccessibilityFilterSelection = useCallback(
    (selection: AccessibilityFilterSelection) => {
      setAccessibilityFilterOverride(
        normalizeAccessibilityFilterSelection(selection, accessibilityFilterOptions),
      );
    },
    [accessibilityFilterOptions],
  );
  const accessibilityFilterState = useMemo<AccessibilityFilterState | null>(() => {
    if (!hasAccessibilityFilterOptions(accessibilityFilterOptions)) return null;
    return {
      options: accessibilityFilterOptions,
      selection: accessibilityFilterSelection,
      setSelection: setAccessibilityFilterSelection,
    };
  }, [accessibilityFilterOptions, accessibilityFilterSelection, setAccessibilityFilterSelection]);
  const stageFilterOptions = useMemo(
    () => buildStageFilterOptions(data.meta, cardTests),
    [cardTests, data.meta],
  );
  const visibleStages = useMemo(
    () => normalizeStageSelection(visibleStageOverride, stageFilterOptions),
    [stageFilterOptions, visibleStageOverride],
  );
  const bisectTestIds = useMemo(
    () => data.bisect == null
      ? new Set<string>()
      : selectionTestIds(data.bisect, bisectSelection),
    [bisectSelection, data.bisect],
  );
  const bisectCategories = useMemo(
    () => data.bisect == null
      ? new Set<BisectCategory>()
      : selectionCategories(data.bisect, bisectSelection),
    [bisectSelection, data.bisect],
  );
  const effectiveVisibleStages = useMemo(() => {
    if (data.bisect == null || bisectSelection.kind === 'all') return visibleStages;
    return stageNamesForCategories(reportStages(data.meta), visibleStages, bisectCategories);
  }, [bisectCategories, bisectSelection.kind, data.bisect, data.meta, visibleStages]);
  const setVisibleStageSelection = useCallback((update: StageFilterSelectionUpdate) => {
    setVisibleStageOverride((previous) => {
      const current = normalizeStageSelection(previous, stageFilterOptions);
      const next = typeof update === 'function' ? update(current) : update;
      return normalizeStageSelection(next, stageFilterOptions);
    });
  }, [stageFilterOptions]);
  const sortOptions = useMemo(() => buildSortOptions(cardTests), [cardTests]);
  const sortValues = useMemo(() => buildSortValues(cardTests), [cardTests]);
  const allTestIds = useMemo(
    () => chipTestSets.get(ALL_FILTER_KEY) ?? new Set<string>(),
    [chipTestSets],
  );
  const visibleTestIds = visibleOverride ?? allTestIds;

  // Each chip is "selected" iff every test it tags is currently visible.
  // Subset coverage means a chip whose tests are all reachable through other
  // active chips also lights up.
  const activeChipKeys = useMemo(() => {
    const out = new Set<string>();
    for (const [tag, ids] of chipTestSets) {
      let covered = true;
      for (const id of ids) {
        if (!visibleTestIds.has(id)) {
          covered = false;
          break;
        }
      }
      if (covered) out.add(tag);
    }
    return out;
  }, [chipTestSets, visibleTestIds]);
  const latestRunKey = useMemo(() => newestRunKey(cardTests), [cardTests]);
  const showRunChips = latestRunKey != null && cardTests.some((test) => runKey(test) !== latestRunKey);
  const missingTests = useMemo(
    () => data.tests.filter((test) => (
      !hasReportableOutcomes(test, isBisectReport) && matchesQuery(test, query)
    )),
    [data.tests, isBisectReport, query],
  );

  // Newer run ids sort first so a filtered run can update a subset without
  // hiding older measurements. Tests outside the visible-id set stay in the
  // list but render dimmed and fall to the back — the filter is a focus
  // tool, not a hard hide.
  const visibleTests = useMemo<{ test: TestResult; dimmed: boolean }[]>(() => {
    const out: { test: TestResult; dimmed: boolean }[] = [];
    for (const t of cardTests) {
      if (!matchesQuery(t, query)) continue;
      const excludedByBisect = data.bisect != null &&
        bisectSelection.kind !== 'all' &&
        !bisectTestIds.has(t.id);
      out.push({ test: t, dimmed: !visibleTestIds.has(t.id) || excludedByBisect });
    }
    out.sort((a, b) => {
      const byDim = Number(a.dimmed) - Number(b.dimmed);
      if (byDim !== 0) return byDim;
      // An active sort fully drives card order (dimmed cards already sank
      // above); otherwise fall back to run-recency then chip ordering.
      if (sort) return compareBySort(a.test, b.test, sort, sortValues);
      return (
        (runKey(b.test) ?? '').localeCompare(runKey(a.test) ?? '') ||
        (b.test.measuredAt ?? 0) - (a.test.measuredAt ?? 0) ||
        compareNullableChips(primaryChip(a.test), primaryChip(b.test))
      );
    });
    return out;
  }, [bisectSelection.kind, bisectTestIds, cardTests, data.bisect, visibleTestIds, query, sort, sortValues]);

  const selectChip = (key: string, additive: boolean) => {
    const chipTests = chipTestSets.get(key) ?? new Set<string>();
    setVisibleOverride((prev) => {
      if (!additive) return new Set(chipTests);
      const current = prev ?? new Set(allTestIds);
      let fullyCovered = true;
      for (const id of chipTests) {
        if (!current.has(id)) {
          fullyCovered = false;
          break;
        }
      }
      const next = new Set(current);
      if (fullyCovered) {
        for (const id of chipTests) next.delete(id);
      } else {
        for (const id of chipTests) next.add(id);
      }
      return next;
    });
  };

  // Cycle a sort dimension: off → worst-first → best-first → off.
  const selectSort = (tag: string) => {
    setSort((prev) => {
      if (!prev || prev.tag !== tag) return { tag, dir: 'worst' };
      if (prev.dir === 'worst') return { tag, dir: 'best' };
      return null;
    });
  };

  return (
    <AccessibilityReportFilterProvider value={accessibilityFilterState}>
      <div className={isBisectReport ? 'app app--bisect' : 'app'}>
        <Header meta={data.meta} total={data.tests.length} />

        <ErrorBanner errors={data.meta.errors ?? []} />

        {data.bisect ? (
          <BisectNavigator
            model={data.bisect}
            selection={bisectSelection}
            onSelect={setBisectSelection}
          />
        ) : null}

        <div className="header__controls">
          <SearchBar value={query} onChange={setQuery} />
          <div className="header__filter-stack">
            <ChipFilter active={activeChipKeys} filters={chipFilters} onSelect={selectChip} />
            <div className="header__secondary-filters">
              <AccessibilityGlobalFilter state={accessibilityFilterState} />
              <StageFilter
                options={stageFilterOptions}
                selected={visibleStages}
                onChange={setVisibleStageSelection}
              />
            </div>
          </div>
          <SkippedChips tests={data.tests} />
        </div>

        {/* Sort row sits on its own line under the filter chips, right-aligned
            to match them. */}
        <SortChips options={sortOptions} active={sort} onSelect={selectSort} />

        {data.bisect ? (
          <BisectSelectionSummary model={data.bisect} selection={bisectSelection} />
        ) : null}

        {visibleTests.length === 0 && missingTests.length === 0 ? (
          <div className="empty">no tests match current filter</div>
        ) : (
          <div className="grid">
            <MissingArtifactsCard meta={data.meta} tests={missingTests} />
            {visibleTests.map(({ test, dimmed }, idx) => (
              <TestCard
                key={test.id}
                test={test}
                meta={data.meta}
                runLabel={showRunChips ? (runKey(test) === latestRunKey ? 'latest' : 'old') : null}
                animationDelayMs={Math.min(idx, 8) * 40}
                dimmed={dimmed}
                visibleStages={effectiveVisibleStages}
              />
            ))}
          </div>
        )}
      </div>
    </AccessibilityReportFilterProvider>
  );
}

function compareNullableChips(a: ChipDescriptor | null, b: ChipDescriptor | null): number {
  if (a && b) return compareChips(a, b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}
