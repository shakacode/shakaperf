import { useMemo, useState } from 'react';
import type { ReportData, Status, TestResult } from './types';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { StatusFilter } from './components/StatusFilter';
import { Section } from './components/Section';
import { TestCard } from './components/TestCard';

const VISIBLE_BY_DEFAULT: Status[] = ['regression', 'visual_change', 'improvement'];
const SECTION_ORDER: Status[] = ['regression', 'visual_change', 'improvement', 'no_difference'];
const SECTION_TITLE: Record<Status, string> = {
  regression: 'performance regressions',
  visual_change: 'visual changes',
  improvement: 'performance improvements',
  no_difference: 'no difference',
};
const ZERO_COUNTS: Record<Status, number> = {
  regression: 0,
  visual_change: 0,
  improvement: 0,
  no_difference: 0,
};

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

  const counts = useMemo(() => {
    const out = { ...ZERO_COUNTS };
    for (const t of data.tests) out[t.status]++;
    return out;
  }, [data.tests]);

  const grouped = useMemo(() => {
    const out: Record<Status, TestResult[]> = {
      regression: [],
      visual_change: [],
      improvement: [],
      no_difference: [],
    };
    for (const t of data.tests) {
      if (!active.has(t.status)) continue;
      if (!matchesQuery(t, query)) continue;
      out[t.status].push(t);
    }
    return out;
  }, [data.tests, active, query]);

  const visibleTotal = SECTION_ORDER.reduce((sum, s) => sum + grouped[s].length, 0);

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

      <div className="header__controls">
        <SearchBar value={query} onChange={setQuery} />
        <StatusFilter active={active} counts={counts} onToggle={toggleStatus} />
      </div>

      {visibleTotal === 0 ? (
        <div className="empty">no tests match current filter</div>
      ) : (
        SECTION_ORDER.map((status) => {
          const tests = grouped[status];
          if (tests.length === 0) return null;
          return (
            <Section key={status} title={SECTION_TITLE[status]} count={tests.length}>
              <div className="grid">
                {tests.map((t, idx) => (
                  <TestCard key={t.id} test={t} animationDelayMs={Math.min(idx, 8) * 40} />
                ))}
              </div>
            </Section>
          );
        })
      )}
    </div>
  );
}
