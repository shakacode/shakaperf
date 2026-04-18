import { useState } from 'react';
import type { TestResult } from '../types';
import { Pill } from './Pill';
import { CategorySlot } from './CategorySlot';

function pillDetailFor(test: TestResult): string | undefined {
  if (test.status !== 'regression' && test.status !== 'improvement') return undefined;
  const perf = test.categories.find((c) => c.category === 'perf')?.perf;
  if (!perf) return undefined;
  const metrics = test.status === 'regression' ? perf.regressedMetrics : perf.improvedMetrics;
  return metrics.length > 0 ? metrics.join(', ') : undefined;
}

export function TestCard({ test, animationDelayMs }: { test: TestResult; animationDelayMs: number }) {
  const [codeOpen, setCodeOpen] = useState(false);
  const pillDetail = pillDetailFor(test);

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
        <Pill status={test.status} detail={pillDetail} />
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
          <CategorySlot key={c.category} result={c} />
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
