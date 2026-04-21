import { useState } from 'react';
import type { CategoryResult, Status, TestResult } from '../types';
import { Pill } from './Pill';
import { CategorySlot } from './CategorySlot';

interface PillSpec {
  status: Status;
  detail?: string;
}

function perfDetailFor(c: CategoryResult): string | undefined {
  if (c.category !== 'perf' || !c.perf) return undefined;
  const metrics =
    c.status === 'regression'
      ? c.perf.regressedMetrics
      : c.status === 'improvement'
        ? c.perf.improvedMetrics
        : [];
  return metrics.length > 0 ? metrics.join(', ') : undefined;
}

function pillsForTest(test: TestResult): PillSpec[] {
  // One pill per category that moved off `no_difference`. A test with
  // visreg=visual_change AND perf=improvement shows both pills.
  const pills = test.categories
    .filter((c) => c.status !== 'no_difference')
    .map<PillSpec>((c) => ({ status: c.status, detail: perfDetailFor(c) }));
  return pills.length > 0 ? pills : [{ status: 'no_difference' }];
}

export function TestCard({ test, animationDelayMs }: { test: TestResult; animationDelayMs: number }) {
  const [codeOpen, setCodeOpen] = useState(false);
  const pills = pillsForTest(test);

  return (
    <article
      className="card"
      data-status={test.status}
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="card__head">
        <div>
          <h3 className="card__title">{test.name}</h3>
          <div className="card__path">{test.filePath}</div>
        </div>
        <div className="card__pills">
          {pills.map((p, i) => (
            <Pill key={`${p.status}-${i}`} status={p.status} detail={p.detail} />
          ))}
        </div>
      </div>

      <dl className="card__urls">
        <div>
          <dt>control</dt>
          <dd>
            <a href={test.controlUrl} target="_blank" rel="noreferrer">
              {test.controlUrl}
            </a>
          </dd>
        </div>
        <div>
          <dt>experiment</dt>
          <dd>
            <a href={test.experimentUrl} target="_blank" rel="noreferrer">
              {test.experimentUrl}
            </a>
          </dd>
        </div>
      </dl>

      <div className="card__body">
        {test.categories.map((c) => (
          <CategorySlot key={c.category} result={c} test={test} />
        ))}

        {test.code ? (
          <div>
            <button
              type="button"
              className="card__code-toggle"
              onClick={() => setCodeOpen((prev) => !prev)}
              aria-expanded={codeOpen}
            >
              {codeOpen ? '▾ test source' : '▸ test source'}
            </button>
            {codeOpen ? <pre className="card__code">{test.code}</pre> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
