import { useMemo, useState } from 'react';
import type { ReportData, Status, TestResult } from './types';
import { STATUS_ORDER } from './labels';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { StatusFilter } from './components/StatusFilter';
import { TestCard } from './components/TestCard';
import { ErrorBanner } from './components/ErrorBanner';

const VISIBLE_BY_DEFAULT: Status[] = ['error', 'regression', 'visual_change', 'improvement'];
const ZERO_COUNTS: Record<Status, number> = {
  error: 0,
  regression: 0,
  visual_change: 0,
  improvement: 0,
  no_difference: 0,
};

/**
 * A test can be both regressed AND improved (different metrics move in
 * opposite directions), or errored AND visually changed (perf measurement
 * failed while visreg succeeded). Return every status that applies so the
 * test contributes to each matching filter count and stays visible when
 * any of those filters is active.
 */
function testStatuses(test: TestResult): Status[] {
  let hasError = false;
  let hasRegression = false;
  let hasImprovement = false;
  let hasVisual = false;
  for (const c of test.categories) {
    if (c.error) hasError = true;
    if (c.category === 'perf') {
      for (const p of c.perfs ?? []) {
        if (p.error) hasError = true;
        if (p.regressedMetrics.length > 0) hasRegression = true;
        if (p.improvedMetrics.length > 0) hasImprovement = true;
      }
    }
    if (c.category === 'visreg' && c.status === 'visual_change') hasVisual = true;
  }
  const out: Status[] = [];
  if (hasError) out.push('error');
  if (hasRegression) out.push('regression');
  if (hasVisual) out.push('visual_change');
  if (hasImprovement) out.push('improvement');
  if (out.length === 0) out.push('no_difference');
  return out;
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

export function App({ data }: { data: ReportData }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Set<Status>>(() => new Set(VISIBLE_BY_DEFAULT));

  const statusesByTest = useMemo(() => {
    const out = new Map<string, Status[]>();
    for (const t of data.tests) out.set(t.id, testStatuses(t));
    return out;
  }, [data.tests]);

  const counts = useMemo(() => {
    const out = { ...ZERO_COUNTS };
    for (const t of data.tests) {
      for (const s of statusesByTest.get(t.id) ?? []) out[s]++;
    }
    return out;
  }, [data.tests, statusesByTest]);

  // One flat list, deduplicated — a test that is both regression and
  // visual_change appears once, not twice. Sort by its highest-priority
  // status so cards pack greedily into the responsive grid without being
  // split by section dividers.
  const visibleTests = useMemo(() => {
    const priority = (s: Status) => STATUS_ORDER.indexOf(s);
    const primary = (statuses: Status[]) =>
      statuses.reduce(
        (best, s) => (priority(s) < priority(best) ? s : best),
        statuses[0] ?? 'no_difference',
      );
    const out: { test: TestResult; primary: Status }[] = [];
    for (const t of data.tests) {
      if (!matchesQuery(t, query)) continue;
      const statuses = statusesByTest.get(t.id) ?? [];
      if (!statuses.some((s) => active.has(s))) continue;
      out.push({ test: t, primary: primary(statuses) });
    }
    out.sort((a, b) => priority(a.primary) - priority(b.primary));
    return out;
  }, [data.tests, active, query, statusesByTest]);

  const toggleStatus = (status: Status) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  return (
    <div className="app">
      <Header meta={data.meta} total={data.tests.length} />

      <ErrorBanner errors={data.meta.errors ?? []} />

      <div className="header__controls">
        <SearchBar value={query} onChange={setQuery} />
        <StatusFilter active={active} counts={counts} onToggle={toggleStatus} />
      </div>

      {visibleTests.length === 0 ? (
        <div className="empty">no tests match current filter</div>
      ) : (
        <div className="grid">
          {visibleTests.map(({ test }, idx) => (
            <TestCard
              key={test.id}
              test={test}
              animationDelayMs={Math.min(idx, 8) * 40}
            />
          ))}
        </div>
      )}
    </div>
  );
}
